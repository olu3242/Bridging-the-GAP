import { describe, expect, it } from "vitest";
import {
  asAnon,
  asServiceRole,
  asUser,
  assignProject,
  completeOnboarding,
  createOrganizationAs,
  createUser,
  expectRejection,
  generatePathwayOnce,
  grantPersonaOperator,
  makeReviewer,
  sql,
  submitEvidence,
  walkBaseline,
} from "./helpers";

const nonce = () => Math.random().toString(36).slice(2, 10);

const VIEWS = [
  "workflow_instance_view",
  "workflow_timeline_view",
  "workflow_work_queue_view",
  "workflow_blockers_view",
] as const;

async function startFor(profile: string, workflow: string, org?: string): Promise<string> {
  return asServiceRole(async (client) => {
    const r = await client.query(
      "select (btg.start_workflow($1, $2, $3, $4)).id as id",
      [workflow, profile, org ?? null, `${workflow}:${profile}:${nonce()}`],
    );
    return r.rows[0].id as string;
  });
}

/** A learner whose verification run is parked on a reviewer. */
async function parkedVerification() {
  const learner = await createUser(`op-learner-${nonce()}`);
  await completeOnboarding(learner.id);
  await walkBaseline(learner.id, { correctly: false });
  await generatePathwayOnce(learner.id);
  const projectId = await assignProject(learner.id, "brief-prompt-design");
  const evidenceId = await submitEvidence(learner.id, projectId);

  const instance = await startFor(learner.id, "verification");
  await asUser(learner.id, async (client) => {
    await client.query("select public.signal_my_workflows('evidence', $1)", [evidenceId]);
    await client.query("select * from public.advance_my_workflows(5)");
  });
  return { learner, evidenceId, instance };
}

describe("the operator can answer every question about a run", () => {
  it("says where it is, why it is waiting and who owes the next action", async () => {
    const { instance } = await parkedVerification();
    const operator = await createUser(`op-who-${nonce()}`);
    await grantPersonaOperator(operator.id);

    const [row] = await asUser(operator.id, async (client) => {
      const r = await client.query(
        "select * from public.workflow_instance_view where instance_id = $1",
        [instance],
      );
      return r.rows as Array<Record<string, unknown>>;
    });

    // 1 where is it · 2 what completed · 3 what is executing
    expect(row.workflow).toBe("verification");
    expect(row.instance_status).toBe("waiting");
    expect(Number(row.steps_total)).toBe(3);
    expect(Number(row.steps_completed)).toBe(1);
    expect(row.current_step).toBe("reviewer_decision");
    // 4 why is it waiting · 5 who owns the next action
    expect(row.waiting_on).toBe("waiting for a reviewer");
    expect(row.owner).toBe("persona:reviewer");
    // 6 what failed · 7 attempts
    expect(row.current_failure).toBeNull();
    expect(Number(row.current_attempts)).toBe(0);
    // 8 SLA · 9 what happens next · 10 which domain entity
    expect(row.deadline_at).not.toBeNull();
    expect(row.overdue).toBe(false);
    expect(row.next_step).toBe("skill_verified");
    expect(row.subject_type).toBe("evidence");
    expect(row.subject_id).not.toBeNull();
  });

  it("states the reason for each kind of wait in words, not statuses", async () => {
    const operator = await createUser(`op-words-${nonce()}`);
    await grantPersonaOperator(operator.id);

    const learner = await createUser(`op-reasons-${nonce()}`);
    await completeOnboarding(learner.id);
    const waitingOnDomain = await startFor(learner.id, "pathway_generation");

    const reasons = await asUser(operator.id, async (client) => {
      const r = await client.query(
        "select instance_id, waiting_on from public.workflow_instance_view where instance_id = any($1::uuid[])",
        [[waitingOnDomain]],
      );
      return Object.fromEntries(r.rows.map((x) => [x.instance_id, x.waiting_on]));
    });
    expect(reasons[waitingOnDomain]).toBe("waiting for learner_baseline_recorded");
  });

  it("shows a failed run as a blocker with its reason, and a finished one not at all", async () => {
    const operator = await createUser(`op-blockers-${nonce()}`);
    await grantPersonaOperator(operator.id);

    // A run that will fail: a step bound to the wrong kind of entity.
    const learner = await createUser(`op-fail-${nonce()}`);
    const key = `probe_${nonce()}`;
    const [def] = await sql<{ id: string }>(
      `insert into public.workflow_definitions (key, name, audit_workflow, is_enabled)
       values ($1, 'Probe', 'matching', true) returning id`,
      [key],
    );
    const [version] = await sql<{ id: string }>(
      "insert into public.workflow_definition_versions (definition_id) values ($1) returning id",
      [def.id],
    );
    await sql(
      `insert into public.workflow_definition_steps
         (definition_version_id, step_key, ordinal, item_type, handler, completion_check)
       values ($1, 'mis_bound', 1, 'system', 'await_domain_state', 'diagnostic_attempt_scored')`,
      [version.id],
    );
    await asServiceRole((client) =>
      client.query("select btg.publish_definition_version($1)", [version.id]),
    );
    const failing = await startFor(learner.id, key);
    const [item] = await sql<{ id: string }>(
      "select id from public.workflow_work_items where workflow_instance_id = $1",
      [failing],
    );
    await asServiceRole(async (client) => {
      await client.query("select btg.bind_work_item_subject($1, 'pathway', $2)", [
        item.id,
        learner.id,
      ]);
      await client.query("select btg.enqueue_workflow_step($1, interval '0', 'probe')", [item.id]);
    });
    for (let pass = 0; pass < 8; pass += 1) {
      await sql(
        `update btg.work_queue set available_at = now()
         where queue = 'workflow' and status = 'queued' and payload->>'instance_id' = $1`,
        [failing],
      );
      await asServiceRole((client) =>
        client.query("select * from btg.dispatch_workflow_work('op', 10, 60, $1)", [failing]),
      );
      const [row] = await sql<{ status: string }>(
        "select status::text as status from public.workflow_instances where id = $1",
        [failing],
      );
      if (row.status === "failed") break;
    }

    const blockers = await asUser(operator.id, async (client) => {
      const r = await client.query(
        "select blocker, severity, waiting_on from public.workflow_blockers_view where instance_id = $1",
        [failing],
      );
      return r.rows as Array<{ blocker: string; severity: number; waiting_on: string }>;
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].blocker).toBe("run_failed");
    expect(Number(blockers[0].severity)).toBe(1);
    expect(blockers[0].waiting_on).toMatch(/needs a diagnostic_attempt subject/);

    // A completed run is not a problem, so it is not on the list.
    const done = await createUser(`op-done-${nonce()}`);
    await completeOnboarding(done.id);
    await walkBaseline(done.id, { correctly: false });
    const completed = await startFor(done.id, "pathway_generation");
    await asUser(done.id, (client) => client.query("select * from public.advance_my_workflows(5)"));
    const notListed = await asUser(operator.id, async (client) => {
      const r = await client.query(
        "select instance_id from public.workflow_blockers_view where instance_id = $1",
        [completed],
      );
      return r.rowCount;
    });
    expect(notListed).toBe(0);
  });

  it("lists a person's outstanding work as a blocker the operator can act on", async () => {
    const { instance } = await parkedVerification();
    const operator = await createUser(`op-person-${nonce()}`);
    await grantPersonaOperator(operator.id);

    const [row] = await asUser(operator.id, async (client) => {
      const r = await client.query(
        "select blocker, owner, current_work_item_id from public.workflow_blockers_view where instance_id = $1",
        [instance],
      );
      return r.rows as Array<Record<string, unknown>>;
    });
    expect(row.blocker).toBe("awaiting_person");
    expect(row.owner).toBe("persona:reviewer");

    // And the operator has a real lever: reassignment.
    const reviewer = await makeReviewer(`op-reassign-${nonce()}`);
    await asUser(operator.id, (client) =>
      client.query("select public.reassign_work_item($1, $2)", [
        row.current_work_item_id,
        reviewer.id,
      ]),
    );
    const [after] = await asUser(operator.id, async (client) => {
      const r = await client.query(
        "select owner from public.workflow_instance_view where instance_id = $1",
        [instance],
      );
      return r.rows as Array<{ owner: string }>;
    });
    expect(after.owner).toBe(`profile:${reviewer.id}`);
  });

  it("shows the execution stream and the evidence trail side by side", async () => {
    const { instance } = await parkedVerification();
    const operator = await createUser(`op-timeline-${nonce()}`);
    await grantPersonaOperator(operator.id);

    const rows = await asUser(operator.id, async (client) => {
      const r = await client.query(
        `select source, event, emitted_by from public.workflow_timeline_view
         where workflow_instance_id = $1 order by occurred_at`,
        [instance],
      );
      return r.rows as Array<{ source: string; event: string; emitted_by: string }>;
    });

    const sources = new Set(rows.map((r) => r.source));
    expect(sources).toContain("orchestration");
    expect(sources).toContain("evidence");
    expect(rows.map((r) => r.event)).toContain("workflow.instance.started");
    expect(rows.map((r) => r.event)).toContain("claimed");
    // Runtime events are attributed to the runtime, not to a person.
    const runtime = rows.filter((r) => r.event === "workflow.instance.started");
    expect(runtime[0].emitted_by).toBe("workflow_runtime");
  });
});

describe("the control plane is a projection, never a way round a policy", () => {
  it("grants nobody a write on any projection", async () => {
    const rows = await sql<{ table_name: string; privilege_type: string; grantee: string }>(
      `select table_name, privilege_type, grantee from information_schema.role_table_grants
       where table_schema = 'public' and table_name = any($1::text[])
         and grantee in ('anon','authenticated')
         and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      [VIEWS],
    );
    expect(rows).toEqual([]);
  });

  it("refuses a write through a projection", async () => {
    const operator = await createUser(`op-nowrite-${nonce()}`);
    await grantPersonaOperator(operator.id);
    const rejection = await asUser(operator.id, (client) =>
      expectRejection(
        client.query("update public.workflow_instance_view set instance_status = 'completed'"),
      ),
    );
    // 55000: the view is not auto-updatable, which is a firmer refusal than a
    // missing privilege -- there is no write path to reach.
    expect(rejection.code).toBe("55000");
  });

  it("keeps the three learner-facing projections on security_invoker", async () => {
    const rows = await sql<{ viewname: string; options: string | null }>(
      `select c.relname as viewname, array_to_string(c.reloptions, ',') as options
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('workflow_instance_view','workflow_work_queue_view','workflow_blockers_view')`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.options ?? "").toContain("security_invoker=true");
  });

  it("gates the timeline on the operator persona, because its source is service-role only", async () => {
    const { instance } = await parkedVerification();

    // The definer view carries the authorization inline; assert it is there.
    const [definition] = await sql<{ def: string }>(
      "select pg_get_viewdef('public.workflow_timeline_view'::regclass) as def",
    );
    expect(definition.def).toContain("is_operator()");

    const learner = await createUser(`op-gate-learner-${nonce()}`);
    const asLearner = await asUser(learner.id, (client) =>
      client.query("select count(*)::int as n from public.workflow_timeline_view"),
    );
    expect(asLearner.rows[0].n).toBe(0);

    const reviewer = await makeReviewer(`op-gate-rev-${nonce()}`);
    const asReviewer = await asUser(reviewer.id, (client) =>
      client.query("select count(*)::int as n from public.workflow_timeline_view"),
    );
    expect(asReviewer.rows[0].n).toBe(0);

    const operator = await createUser(`op-gate-op-${nonce()}`);
    await grantPersonaOperator(operator.id);
    const asOperator = await asUser(operator.id, (client) =>
      client.query(
        "select count(*)::int as n from public.workflow_timeline_view where workflow_instance_id = $1",
        [instance],
      ),
    );
    expect(asOperator.rows[0].n).toBeGreaterThan(0);
  });

  it("leaves the orchestration stream itself unreadable from any session", async () => {
    const operator = await createUser(`op-stream-${nonce()}`);
    await grantPersonaOperator(operator.id);
    const denied = await asUser(operator.id, (client) =>
      expectRejection(client.query("select count(*) from btg.orchestration_events")),
    );
    expect(denied.code).toBe("42501");
  });

  it("shows a learner only their own run, through every projection", async () => {
    const { instance } = await parkedVerification();
    const stranger = await createUser(`op-stranger-${nonce()}`);

    for (const view of ["workflow_instance_view", "workflow_work_queue_view", "workflow_blockers_view"]) {
      const seen = await asUser(stranger.id, (client) =>
        client.query(
          `select count(*)::int as n from public.${view} where ${
            view === "workflow_work_queue_view" ? "workflow_instance_id" : "instance_id"
          } = $1`,
          [instance],
        ),
      );
      expect({ view, n: seen.rows[0].n }).toEqual({ view, n: 0 });
    }
  });

  it("shows an organization's run to its admin and not to another organization's", async () => {
    const owner = await createUser(`op-org-a-${nonce()}`);
    const outsider = await createUser(`op-org-b-${nonce()}`);
    const subject = await createUser(`op-org-subj-${nonce()}`);
    const org = await createOrganizationAs(owner.id, `op-org-${nonce()}`);
    await createOrganizationAs(outsider.id, `op-other-${nonce()}`);

    const instance = await startFor(subject.id, "pathway_generation", org.id);

    const mine = await asUser(owner.id, (client) =>
      client.query(
        "select count(*)::int as n from public.workflow_instance_view where instance_id = $1",
        [instance],
      ),
    );
    expect(mine.rows[0].n).toBe(1);

    const theirs = await asUser(outsider.id, (client) =>
      client.query(
        "select count(*)::int as n from public.workflow_instance_view where instance_id = $1",
        [instance],
      ),
    );
    expect(theirs.rows[0].n).toBe(0);
  });

  it("shows an anonymous visitor nothing", async () => {
    for (const view of VIEWS) {
      const rejection = await asAnon((client) =>
        expectRejection(client.query(`select count(*) from public.${view}`)),
      );
      expect(rejection.code).toBe("42501");
    }
  });
});
