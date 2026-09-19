import { describe, expect, it } from "vitest";
import {
  asAnon,
  asServiceRole,
  asUser,
  completeOnboarding,
  createOrganizationAs,
  createUser,
  expectRejection,
  sql,
  walkBaseline,
} from "./helpers";

const nonce = () => Math.random().toString(36).slice(2, 10);

/** Exactly what the server action runs after a governed command succeeds. */
async function continueWork(
  userId: string,
  options: { workflows?: string[]; subjectType?: string; subjectId?: string } = {},
) {
  return asUser(userId, async (client) => {
    for (const workflow of options.workflows ?? []) {
      await client.query("select public.ensure_my_workflow($1)", [workflow]);
    }
    await client.query("select public.signal_my_workflows($1, $2)", [
      options.subjectType ?? null,
      options.subjectId ?? null,
    ]);
    const result = await client.query("select * from public.advance_my_workflows(5)");
    return result.rows[0] as Record<string, number>;
  });
}

async function activePathway(profileId: string) {
  const [row] = await sql<{ id: string; version: number; steps: string }>(
    `select p.id, p.version,
            (select count(*)::text from public.pathway_steps s where s.pathway_id = p.id) as steps
     from public.pathways p where p.profile_id = $1 and p.status = 'active'`,
    [profileId],
  );
  return row ?? null;
}

async function instanceFor(profileId: string, workflow: string) {
  const [row] = await sql<{ id: string; status: string }>(
    `select i.id, i.status::text as status
     from public.workflow_instances i
     join public.workflow_definition_versions v on v.id = i.definition_version_id
     join public.workflow_definitions d on d.id = v.definition_id
     where i.subject_profile_id = $1 and d.key = $2`,
    [profileId, workflow],
  );
  return row ?? null;
}

describe("diagnostic to pathway, driven from the application", () => {
  it("carries a learner from a measured baseline to a generated pathway", async () => {
    const learner = await createUser(`app-vertical-${nonce()}`);
    await completeOnboarding(learner.id);

    // The learner's own actions, through the governed commands the UI calls.
    const { attemptId } = await walkBaseline(learner.id, { correctly: false });
    expect(await activePathway(learner.id)).toBeNull();

    // The continuation the action runs once the engine has scored the attempt.
    const tally = await continueWork(learner.id, {
      workflows: ["pathway_generation"],
      subjectType: "diagnostic_attempt",
      subjectId: attemptId,
    });
    expect(Number(tally.instances)).toBeGreaterThanOrEqual(1);
    expect(Number(tally.failed)).toBe(0);

    // The pathway engine produced the pathway -- the workflow only coordinated.
    const pathway = await activePathway(learner.id);
    expect(pathway).not.toBeNull();
    expect(Number(pathway!.steps)).toBeGreaterThan(0);

    const instance = await instanceFor(learner.id, "pathway_generation");
    expect(instance!.status).toBe("completed");

    // Evidence lineage: the learner's own timeline shows it, attributed to the
    // runtime that did it.
    const timeline = await asUser(learner.id, (client) =>
      client.query(
        `select outcome, stage from public.outcome_timeline_view
         where profile_id = $1 and outcome in ('baseline_measured','pathway_generated')
         order by stage`,
        [learner.id],
      ),
    );
    expect(timeline.rows.map((r) => r.outcome)).toEqual([
      "baseline_measured",
      "pathway_generated",
    ]);

    // And the application can see where the run got to.
    const state = await asUser(learner.id, (client) =>
      client.query(
        `select workflow, instance_status, step_key, work_item_status
         from public.my_workflow_state where profile_id = $1 and workflow = 'pathway_generation'
         order by step_ordinal`,
        [learner.id],
      ),
    );
    expect(state.rows.map((r) => r.work_item_status)).toEqual(["completed", "completed"]);
  });

  it("does not duplicate anything on a refresh, a retry or a double submit", async () => {
    const learner = await createUser(`app-replay-${nonce()}`);
    await completeOnboarding(learner.id);
    const { attemptId } = await walkBaseline(learner.id, { correctly: false });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await continueWork(learner.id, {
        workflows: ["pathway_generation"],
        subjectType: "diagnostic_attempt",
        subjectId: attemptId,
      });
    }

    // One instance, one active pathway, one version: the engine was not run
    // three times and the runtime did not start three runs.
    const [{ instances }] = await sql<{ instances: string }>(
      `select count(*)::text as instances from public.workflow_instances i
       join public.workflow_definition_versions v on v.id = i.definition_version_id
       join public.workflow_definitions d on d.id = v.definition_id
       where i.subject_profile_id = $1 and d.key = 'pathway_generation'`,
      [learner.id],
    );
    expect(Number(instances)).toBe(1);

    const [{ pathways }] = await sql<{ pathways: string }>(
      "select count(*)::text as pathways from public.pathways where profile_id = $1",
      [learner.id],
    );
    expect(Number(pathways)).toBe(1);

    const [{ events }] = await sql<{ events: string }>(
      `select count(*)::text as events from public.audit_events
       where action = 'pathway.pathway.generated'
         and (actor_profile_id = $1 or metadata->>'subject' = $1::text)`,
      [learner.id],
    );
    expect(Number(events)).toBe(1);
  });

  it("leaves a stalled step as visible state rather than a failure", async () => {
    // No baseline yet: the pathway workflow legitimately has nothing to do.
    const learner = await createUser(`app-stall-${nonce()}`);
    await completeOnboarding(learner.id);

    const tally = await continueWork(learner.id, { workflows: ["pathway_generation"] });
    expect(Number(tally.failed)).toBe(0);
    expect(await activePathway(learner.id)).toBeNull();

    const state = await asUser(learner.id, (client) =>
      client.query(
        `select instance_status, step_key, work_item_status
         from public.my_workflow_state where profile_id = $1 and workflow = 'pathway_generation'
         order by step_ordinal`,
        [learner.id],
      ),
    );
    // Waiting on the baseline, and the application can say exactly that.
    expect(state.rows[0].instance_status).toBe("active");
    expect(state.rows[0].step_key).toBe("baseline_measured");
    expect(state.rows[0].work_item_status).toBe("ready");

    // Once the learner does the work, the same continuation completes it.
    await walkBaseline(learner.id, { correctly: false });
    await continueWork(learner.id, { workflows: ["pathway_generation"] });
    expect(await activePathway(learner.id)).not.toBeNull();
  });
});

describe("the application's surface is narrow and scoped to its caller", () => {
  it("refuses a workflow the platform did not mark self-startable", async () => {
    const learner = await createUser(`app-notself-${nonce()}`);
    const rejection = await asUser(learner.id, (client) =>
      expectRejection(client.query("select public.ensure_my_workflow('credentials')")),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses an organization-scoped workflow", async () => {
    const learner = await createUser(`app-orgscope-${nonce()}`);
    await sql(
      "update public.workflow_definitions set is_self_startable = true where key = 'organization_provisioning'",
    );
    try {
      const rejection = await asUser(learner.id, (client) =>
        expectRejection(
          client.query("select public.ensure_my_workflow('organization_provisioning')"),
        ),
      );
      expect(rejection.code).toBe("42501");
    } finally {
      await sql(
        "update public.workflow_definitions set is_self_startable = false where key = 'organization_provisioning'",
      );
    }
  });

  it("signals only the caller's own runs", async () => {
    const learner = await createUser(`app-signal-a-${nonce()}`);
    const stranger = await createUser(`app-signal-b-${nonce()}`);
    await completeOnboarding(learner.id);
    await walkBaseline(learner.id, { correctly: false });

    await asUser(learner.id, (client) =>
      client.query("select public.ensure_my_workflow('pathway_generation')"),
    );

    // The stranger's signal reaches nothing: the profile is auth.uid(), never
    // an argument, so there is no parameter to point at somebody else.
    const reached = await asUser(stranger.id, async (client) => {
      const r = await client.query("select public.signal_my_workflows(null, null) as n");
      return Number(r.rows[0].n);
    });
    expect(reached).toBe(0);

    const advanced = await asUser(stranger.id, async (client) => {
      const r = await client.query("select * from public.advance_my_workflows(5)");
      return Number(r.rows[0].instances);
    });
    expect(advanced).toBe(0);
    expect(await activePathway(learner.id)).toBeNull();
  });

  it("advances nothing for an anonymous visitor", async () => {
    for (const call of [
      "select public.ensure_my_workflow('pathway_generation')",
      "select public.signal_my_workflows(null, null)",
      "select * from public.advance_my_workflows(5)",
      "select count(*) from public.my_workflow_state",
    ]) {
      const rejection = await asAnon((client) => expectRejection(client.query(call)));
      expect(rejection.code).toBe("42501");
    }
  });

  it("shows a learner their own runs and nobody else's", async () => {
    const learner = await createUser(`app-state-a-${nonce()}`);
    const stranger = await createUser(`app-state-b-${nonce()}`);
    await asUser(learner.id, (client) =>
      client.query("select public.ensure_my_workflow('pathway_generation')"),
    );

    const mine = await asUser(learner.id, (client) =>
      client.query("select count(*)::int as n from public.my_workflow_state"),
    );
    expect(mine.rows[0].n).toBeGreaterThan(0);

    const theirs = await asUser(stranger.id, (client) =>
      client.query("select count(*)::int as n from public.my_workflow_state where profile_id = $1", [
        learner.id,
      ]),
    );
    expect(theirs.rows[0].n).toBe(0);
  });

  it("gives the application no way to complete a step itself", async () => {
    const learner = await createUser(`app-nocomplete-${nonce()}`);
    await asUser(learner.id, (client) =>
      client.query("select public.ensure_my_workflow('pathway_generation')"),
    );
    const instance = await instanceFor(learner.id, "pathway_generation");
    const [item] = await sql<{ id: string }>(
      "select id from public.workflow_work_items where workflow_instance_id = $1 limit 1",
      [instance!.id],
    );

    for (const call of [
      "select btg.complete_work_item($1)",
      "select btg.bind_work_item_subject($1, 'diagnostic_attempt', $1)",
      "select btg.fail_work_item($1, 'forced')",
    ]) {
      const rejection = await asUser(learner.id, (client) =>
        expectRejection(client.query(call, [item.id])),
      );
      expect(rejection.code).toBe("42501");
    }

    const direct = await asUser(learner.id, (client) =>
      expectRejection(
        client.query("update public.workflow_work_items set status = 'completed' where id = $1", [
          item.id,
        ]),
      ),
    );
    expect(direct.code).toBe("42501");
  });

  it("cannot be used to run work for an organization's instance", async () => {
    const owner = await createUser(`app-orginst-${nonce()}`);
    const subject = await createUser(`app-orgsubj-${nonce()}`);
    const org = await createOrganizationAs(owner.id, `app-org-${nonce()}`);

    const instance = await asServiceRole(async (client) => {
      const r = await client.query(
        "select (btg.start_workflow('pathway_generation', $1, $2, $3)).id as id",
        [subject.id, org.id, `org-pathway:${nonce()}`],
      );
      return r.rows[0].id as string;
    });

    // The org admin can read it, but advance_my_workflows is keyed on
    // subject_profile_id -- it is not theirs to run.
    const readable = await asUser(owner.id, (client) =>
      client.query("select id from public.workflow_instances where id = $1", [instance]),
    );
    expect(readable.rowCount).toBe(1);

    const advanced = await asUser(owner.id, async (client) => {
      const r = await client.query("select * from public.advance_my_workflows(5)");
      return Number(r.rows[0].instances);
    });
    expect(advanced).toBe(0);
  });
});
