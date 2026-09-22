import { describe, expect, it } from "vitest";
import {
  asAnon,
  asServiceRole,
  asUser,
  completeOnboarding,
  createOrganizationAs,
  createUser,
  expectRejection,
  grantPersonaOperator,
  sql,
  startBaseline,
  walkBaseline,
} from "./helpers";

/** Unique suffix so a shared database cannot make these tests order-dependent. */
const nonce = () => Math.random().toString(36).slice(2, 10);

/** A throwaway definition with one draft version, for the version-rule tests. */
async function draftDefinition(): Promise<{ definition: string; version: string }> {
  const key = `probe_${nonce()}`;
  const [def] = await sql<{ id: string }>(
    `insert into public.workflow_definitions (key, name, audit_workflow, is_enabled)
     values ($1, 'Probe workflow', 'baseline_diagnostic', true) returning id`,
    [key],
  );
  const [version] = await sql<{ id: string }>(
    `insert into public.workflow_definition_versions (definition_id, notes)
     values ($1, 'probe') returning id`,
    [def.id],
  );
  return { definition: def.id, version: version.id };
}

async function addStep(
  versionId: string,
  stepKey: string,
  ordinal: number,
  check: string | null = "learner_baseline_recorded",
) {
  await sql(
    `insert into public.workflow_definition_steps
       (definition_version_id, step_key, ordinal, item_type, handler, completion_check)
     values ($1, $2, $3, 'system', 'await_domain_state', $4)`,
    [versionId, stepKey, ordinal, check],
  );
}

async function itemsOf(instanceId: string) {
  return sql<{ step_key: string; status: string; subject_type: string | null }>(
    `select w.step_key, w.status::text as status, w.subject_type
     from public.workflow_work_items w
     join public.workflow_instances i on i.id = w.workflow_instance_id
     join public.workflow_definition_steps s
       on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
     where w.workflow_instance_id = $1 order by s.ordinal`,
    [instanceId],
  );
}

async function instanceOf(instanceId: string) {
  const [row] = await sql<{ status: string; settled_at: string | null; failure: string | null }>(
    "select status::text as status, settled_at, failure from public.workflow_instances where id = $1",
    [instanceId],
  );
  return row;
}

async function startBaselineWorkflow(userId: string, key = "baseline_diagnostic") {
  return asServiceRole(async (client) => {
    const result = await client.query(
      "select (btg.start_workflow($1, $2, null, $3)).id as id",
      [key, userId, `${key}:${userId}`],
    );
    return result.rows[0].id as string;
  });
}

async function itemId(instanceId: string, stepKey: string): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `select id from public.workflow_work_items
     where workflow_instance_id = $1 and step_key = $2 and status <> 'cancelled'`,
    [instanceId, stepKey],
  );
  return row.id;
}

describe("definitions and versions", () => {
  it("reserves every workflow label the ledger emits, plus the coordinator", async () => {
    const rows = await sql<{ key: string }>("select key from public.workflow_definitions");
    const keys = rows.map((r) => r.key);
    const taxonomy = await sql<{ label: string }>("select label from btg.workflow_taxonomy");
    for (const { label } of taxonomy) expect(keys).toContain(label);
    expect(keys).toContain("BTG_LEARNER_TO_OPPORTUNITY");
  });

  it("files every definition under a label the audit taxonomy recognises", async () => {
    const rows = await sql<{ key: string }>(
      `select d.key from public.workflow_definitions d
       where d.audit_workflow is not null
         and d.audit_workflow not in (select label from btg.workflow_taxonomy)`,
    );
    expect(rows).toEqual([]);
  });

  it("never emits a ledger workflow label outside the taxonomy", async () => {
    const rows = await sql<{ workflow: string }>(
      `select distinct workflow from public.audit_events
       where workflow is not null
         and workflow not in (select label from btg.workflow_taxonomy)`,
    );
    expect(rows).toEqual([]);
  });

  it("enables only the workflows whose batch has landed", async () => {
    const rows = await sql<{ key: string }>(
      "select key from public.workflow_definitions where is_enabled order by key",
    );
    expect(rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(["baseline_diagnostic"]),
    );
    // No seeded definition is enabled without a published version to run: an
    // enabled definition with nothing published would fail at start time
    // rather than be plainly unavailable. `probe_%` keys are this file's own
    // fixtures, which deliberately include that broken shape.
    const unbuilt = await sql<{ key: string }>(
      `select d.key from public.workflow_definitions d
       where d.is_enabled and d.key not like 'probe\_%'
         and not exists (select 1 from public.workflow_definition_versions v
                         where v.definition_id = d.id and v.status = 'published')`,
    );
    expect(unbuilt).toEqual([]);
  });

  it("numbers versions monotonically and refuses a chosen number", async () => {
    const { definition } = await draftDefinition();
    const rejection = await expectRejection(
      sql(
        `insert into public.workflow_definition_versions (definition_id, version)
         values ($1, 7)`,
        [definition],
      ),
    );
    expect(rejection.code).toBe("23514");
    const [next] = await sql<{ version: number }>(
      `insert into public.workflow_definition_versions (definition_id)
       values ($1) returning version`,
      [definition],
    );
    expect(next.version).toBe(2);
  });

  it("refuses to publish a version with no steps", async () => {
    const { version } = await draftDefinition();
    const rejection = await asServiceRole((client) =>
      expectRejection(client.query("select btg.publish_definition_version($1)", [version])),
    );
    expect(rejection.message).toMatch(/no steps/);
  });

  it("refuses to publish a catalog with a gap in its ordinals", async () => {
    const { version } = await draftDefinition();
    await addStep(version, "first", 1);
    await addStep(version, "third", 3);
    const rejection = await asServiceRole((client) =>
      expectRejection(client.query("select btg.publish_definition_version($1)", [version])),
    );
    expect(rejection.message).toMatch(/ordinals/);
  });

  it("holds a published version immutable", async () => {
    const { version } = await draftDefinition();
    await addStep(version, "only", 1);
    await asServiceRole((client) =>
      client.query("select btg.publish_definition_version($1)", [version]),
    );

    const notes = await expectRejection(
      sql("update public.workflow_definition_versions set notes = 'rewritten' where id = $1", [
        version,
      ]),
    );
    expect(notes.code).toBe("42501");

    const deletion = await expectRejection(
      sql("delete from public.workflow_definition_versions where id = $1", [version]),
    );
    expect(deletion.code).toBe("42501");
  });

  it("freezes the step catalog when the version publishes", async () => {
    const { version } = await draftDefinition();
    await addStep(version, "only", 1);
    await asServiceRole((client) =>
      client.query("select btg.publish_definition_version($1)", [version]),
    );
    const rejection = await expectRejection(addStep(version, "sneaked_in", 2));
    expect(rejection.code).toBe("42501");
  });

  it("supersedes the previous version explicitly rather than replacing it", async () => {
    const { definition, version } = await draftDefinition();
    await addStep(version, "v1_step", 1);
    await asServiceRole((client) =>
      client.query("select btg.publish_definition_version($1)", [version]),
    );

    const [second] = await sql<{ id: string }>(
      `insert into public.workflow_definition_versions (definition_id) values ($1) returning id`,
      [definition],
    );
    await addStep(second.id, "v2_step", 1);
    await asServiceRole((client) =>
      client.query("select btg.publish_definition_version($1)", [second.id]),
    );

    const rows = await sql<{ version: number; status: string; superseded_by: string | null }>(
      `select version, status::text as status, superseded_by
       from public.workflow_definition_versions where definition_id = $1 order by version`,
      [definition],
    );
    expect(rows).toEqual([
      { version: 1, status: "superseded", superseded_by: second.id },
      { version: 2, status: "published", superseded_by: null },
    ]);
  });

  it("keeps at most one published version per definition", async () => {
    const rows = await sql<{ definition_id: string; n: string }>(
      `select definition_id, count(*)::text as n from public.workflow_definition_versions
       where status = 'published' group by definition_id having count(*) > 1`,
    );
    expect(rows).toEqual([]);
  });
});

describe("instances", () => {
  it("materializes the pinned catalog and readies only the first step", async () => {
    const learner = await createUser(`wf-start-${nonce()}`);
    await completeOnboarding(learner.id);
    const instance = await startBaselineWorkflow(learner.id);

    expect(await instanceOf(instance)).toMatchObject({ status: "active", settled_at: null });
    const items = await itemsOf(instance);
    expect(items.map((i) => [i.step_key, i.status])).toEqual([
      ["attempt_started", "ready"],
      ["attempt_scored", "pending"],
      ["baseline_recorded", "pending"],
    ]);
  });

  it("is idempotent on its key", async () => {
    const learner = await createUser(`wf-idem-${nonce()}`);
    const first = await startBaselineWorkflow(learner.id);
    const second = await startBaselineWorkflow(learner.id);
    expect(second).toBe(first);
    const [{ n }] = await sql<{ n: string }>(
      "select count(*)::text as n from public.workflow_instances where subject_profile_id = $1",
      [learner.id],
    );
    expect(Number(n)).toBe(1);
  });

  it("pins its definition version and refuses to be migrated silently", async () => {
    const learner = await createUser(`wf-pin-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);
    const { version } = await draftDefinition();

    const rejection = await expectRejection(
      sql("update public.workflow_instances set definition_version_id = $1 where id = $2", [
        version,
        instance,
      ]),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses to change subject", async () => {
    const learner = await createUser(`wf-subject-${nonce()}`);
    const other = await createUser(`wf-subject-other-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);
    const rejection = await expectRejection(
      sql("update public.workflow_instances set subject_profile_id = $1 where id = $2", [
        other.id,
        instance,
      ]),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses a definition that is not enabled", async () => {
    const learner = await createUser(`wf-disabled-${nonce()}`);
    const rejection = await asServiceRole((client) =>
      expectRejection(
        client.query("select btg.start_workflow('credentials', $1, null, null)", [learner.id]),
      ),
    );
    expect(rejection.message).toMatch(/not enabled/);
  });

  it("refuses a definition with no published version", async () => {
    const learner = await createUser(`wf-unpublished-${nonce()}`);
    const key = `probe_${nonce()}`;
    await sql(
      `insert into public.workflow_definitions (key, name, is_enabled) values ($1, 'Probe', true)`,
      [key],
    );
    const rejection = await asServiceRole((client) =>
      expectRejection(
        client.query("select btg.start_workflow($1, $2, null, null)", [key, learner.id]),
      ),
    );
    expect(rejection.message).toMatch(/no published version/);
  });

  it("refuses a handler no dispatcher resolves yet", async () => {
    const learner = await createUser(`wf-handler-${nonce()}`);
    const { definition, version } = await draftDefinition();
    await sql(
      `insert into public.workflow_definition_steps
         (definition_version_id, step_key, ordinal, item_type, handler)
       values ($1, 'ask_the_model', 1, 'ai', 'ai_worker')`,
      [version],
    );
    await asServiceRole((client) =>
      client.query("select btg.publish_definition_version($1)", [version]),
    );
    const [{ key }] = await sql<{ key: string }>(
      "select key from public.workflow_definitions where id = $1",
      [definition],
    );
    const rejection = await asServiceRole((client) =>
      expectRejection(
        client.query("select btg.start_workflow($1, $2, null, null)", [key, learner.id]),
      ),
    );
    expect(rejection.code).toBe("0A000");
    expect(rejection.message).toMatch(/ai_worker/);
  });
});

describe("the projection guarantee", () => {
  it("refuses to complete a step the domain does not show", async () => {
    const learner = await createUser(`wf-unproven-${nonce()}`);
    await completeOnboarding(learner.id);
    const instance = await startBaselineWorkflow(learner.id);
    const attemptId = await startBaseline(learner.id);
    const item = await itemId(instance, "attempt_started");

    // Bind the real attempt, then try to complete the *scored* step's check
    // against an attempt that is still in progress.
    await asServiceRole((client) =>
      client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        item,
        attemptId,
      ]),
    );
    await asServiceRole((client) => client.query("select btg.complete_work_item($1)", [item]));

    const scored = await itemId(instance, "attempt_scored");
    await asServiceRole((client) =>
      client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        scored,
        attemptId,
      ]),
    );
    const rejection = await asServiceRole((client) =>
      expectRejection(client.query("select btg.complete_work_item($1)", [scored])),
    );
    expect(rejection.message).toMatch(/does not show diagnostic_attempt_scored/);
    expect((await itemsOf(instance))[1].status).toBe("ready");
  });

  it("refuses another learner's domain entity as the subject", async () => {
    const learner = await createUser(`wf-cross-a-${nonce()}`);
    const stranger = await createUser(`wf-cross-b-${nonce()}`);
    await completeOnboarding(learner.id);
    await completeOnboarding(stranger.id);
    const instance = await startBaselineWorkflow(learner.id);
    const { attemptId: strangersAttempt } = await walkBaseline(stranger.id, { correctly: true });

    const item = await itemId(instance, "attempt_started");
    await asServiceRole((client) =>
      client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        item,
        strangersAttempt,
      ]),
    );
    const rejection = await asServiceRole((client) =>
      expectRejection(client.query("select btg.complete_work_item($1)", [item])),
    );
    expect(rejection.message).toMatch(/does not show diagnostic_attempt_started/);
  });

  it("refuses a check pointed at the wrong kind of entity", async () => {
    const learner = await createUser(`wf-wrongtype-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);
    const item = await itemId(instance, "attempt_started");
    await asServiceRole((client) =>
      client.query("select btg.bind_work_item_subject($1, 'pathway', $2)", [item, learner.id]),
    );
    const rejection = await asServiceRole((client) =>
      expectRejection(client.query("select btg.complete_work_item($1)", [item])),
    );
    expect(rejection.message).toMatch(/needs a diagnostic_attempt subject/);
  });

  it("refuses an unregistered completion check", async () => {
    const rejection = await asServiceRole((client) =>
      expectRejection(
        client.query(
          "select btg.assert_step_satisfied('drop_everything', null, null, null)",
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses to complete a step out of order", async () => {
    const learner = await createUser(`wf-order-${nonce()}`);
    await completeOnboarding(learner.id);
    const instance = await startBaselineWorkflow(learner.id);
    const last = await itemId(instance, "baseline_recorded");
    const rejection = await asServiceRole((client) =>
      expectRejection(client.query("select btg.complete_work_item($1)", [last])),
    );
    expect(rejection.message).toMatch(/pending work item cannot be completed/);
  });

  it("walks the whole baseline workflow on real engine state and leaves evidence", async () => {
    const learner = await createUser(`wf-journey-${nonce()}`);
    await completeOnboarding(learner.id);
    const instance = await startBaselineWorkflow(learner.id);

    // Step 1: the learner starts an attempt, through the governed command.
    const attemptId = await startBaseline(learner.id);
    const started = await itemId(instance, "attempt_started");
    await asServiceRole(async (client) => {
      await client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        started,
        attemptId,
      ]);
      await client.query("select btg.complete_work_item($1, $2)", [
        started,
        JSON.stringify({ attempt: attemptId }),
      ]);
    });
    expect((await itemsOf(instance)).map((i) => i.status)).toEqual([
      "completed",
      "ready",
      "pending",
    ]);

    // Step 2: the learner answers and submits. The diagnostic engine grades,
    // estimates and writes the baseline -- the workflow does none of it.
    const { attemptId: walked } = await walkBaseline(learner.id, { correctly: true });
    expect(walked).toBe(attemptId);

    const scored = await itemId(instance, "attempt_scored");
    await asServiceRole(async (client) => {
      await client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        scored,
        attemptId,
      ]);
      await client.query("select btg.complete_work_item($1)", [scored]);
    });

    // Step 3: the baseline the engine wrote is what closes the workflow.
    const recorded = await itemId(instance, "baseline_recorded");
    await asServiceRole((client) =>
      client.query("select btg.complete_work_item($1)", [recorded]),
    );

    expect((await itemsOf(instance)).map((i) => i.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    const settled = await instanceOf(instance);
    expect(settled.status).toBe("completed");
    expect(settled.settled_at).not.toBeNull();

    // The domain state the workflow waited for is real.
    const [{ n }] = await sql<{ n: string }>(
      `select count(*)::text as n from public.learner_competencies
       where profile_id = $1 and source = 'baseline'`,
      [learner.id],
    );
    expect(Number(n)).toBeGreaterThan(0);

    // Evidence: runtime events are attributed to the runtime, never the learner.
    const events = await sql<{ action: string; actor_profile_id: string | null; actor: string }>(
      `select action, actor_profile_id, metadata->>'actor' as actor
       from public.audit_events
       where object_id = any($1::text[]) and action like 'workflow.%'
       order by occurred_at`,
      [[instance, started, scored, recorded]],
    );
    expect(events.map((e) => e.action)).toEqual([
      "workflow.instance.started",
      "workflow.work_item.completed",
      "workflow.work_item.completed",
      "workflow.work_item.completed",
      "workflow.instance.completed",
    ]);
    for (const event of events) {
      expect(event.actor_profile_id).toBeNull();
      expect(event.actor).toBe("workflow_runtime");
    }

    // And the engine's own evidence is untouched and still the learner's.
    const [engineEvent] = await sql<{ actor_profile_id: string }>(
      `select actor_profile_id from public.audit_events
       where actor_profile_id = $1 and action = 'diagnostic.attempt.scored'`,
      [learner.id],
    );
    expect(engineEvent.actor_profile_id).toBe(learner.id);
  });

  it("is idempotent on completion", async () => {
    const learner = await createUser(`wf-recomplete-${nonce()}`);
    await completeOnboarding(learner.id);
    const instance = await startBaselineWorkflow(learner.id);
    const attemptId = await startBaseline(learner.id);
    const item = await itemId(instance, "attempt_started");

    await asServiceRole(async (client) => {
      await client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        item,
        attemptId,
      ]);
      await client.query("select btg.complete_work_item($1)", [item]);
      await client.query("select btg.complete_work_item($1)", [item]);
    });

    const [{ n }] = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_events
       where object_id = $1 and action = 'workflow.work_item.completed'`,
      [item],
    );
    expect(Number(n)).toBe(1);
  });
});

describe("failure and cancellation", () => {
  it("retries a failing step then fails the instance", async () => {
    const learner = await createUser(`wf-fail-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);
    const item = await itemId(instance, "attempt_started");

    await asServiceRole(async (client) => {
      await client.query("select btg.fail_work_item($1, 'first')", [item]);
      await client.query("select btg.fail_work_item($1, 'second')", [item]);
    });
    expect(await instanceOf(instance)).toMatchObject({ status: "active" });

    await asServiceRole((client) =>
      client.query("select btg.fail_work_item($1, 'third')", [item]),
    );

    const [row] = await sql<{ status: string; attempts: number; failure: string }>(
      "select status::text as status, attempts, failure from public.workflow_work_items where id = $1",
      [item],
    );
    expect(row).toMatchObject({ status: "failed", attempts: 3, failure: "third" });
    const settled = await instanceOf(instance);
    expect(settled.status).toBe("failed");
    expect(settled.failure).toMatch(/attempt_started: third/);
  });

  it("cancels every open item with the instance", async () => {
    const learner = await createUser(`wf-cancel-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);
    await asServiceRole((client) =>
      client.query("select btg.cancel_workflow($1, 'pilot reset')", [instance]),
    );
    const items = await itemsOf(instance);
    expect(items.map((i) => i.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(await instanceOf(instance)).toMatchObject({ status: "cancelled" });
  });

  it("refuses an illegal lifecycle move through the registry", async () => {
    const learner = await createUser(`wf-registry-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);
    const rejection = await expectRejection(
      sql("update public.workflow_instances set status = 'created' where id = $1", [instance]),
    );
    expect(rejection.message).toMatch(/workflow_instance/);
  });
});

describe("the workflow runtime's security boundary", () => {
  const RUNTIME_FUNCTIONS = [
    "btg.start_workflow(text, uuid, uuid, text)",
    "btg.advance_instance(uuid)",
    "btg.complete_work_item(uuid, jsonb)",
    "btg.fail_work_item(uuid, text)",
    "btg.cancel_workflow(uuid, text)",
    "btg.bind_work_item_subject(uuid, text, uuid)",
    "btg.publish_definition_version(uuid)",
    "btg.assert_step_satisfied(text, text, uuid, uuid)",
    "btg.record_workflow_event(text, text, text, uuid, jsonb, jsonb, public.btg_audit_severity, text, jsonb)",
  ];

  const WORKFLOW_TABLES = [
    "workflow_definitions",
    "workflow_definition_versions",
    "workflow_definition_steps",
    "workflow_instances",
    "workflow_work_items",
  ];

  it("gives no session role EXECUTE on any runtime function", async () => {
    for (const fn of RUNTIME_FUNCTIONS) {
      const [row] = await sql<{ anon: boolean; authed: boolean; worker: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authed,
                has_function_privilege('service_role', $1, 'execute') as worker`,
        [fn],
      );
      expect({ fn, ...row }).toEqual({ fn, anon: false, authed: false, worker: true });
    }
  });

  it("gives authenticated no write path to execution state", async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated'
         and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
         and table_name = any($1::text[])`,
      [WORKFLOW_TABLES],
    );
    expect(rows).toEqual([]);
  });

  it("gives anon nothing at all", async () => {
    const rows = await sql<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon' and table_name = any($1::text[])`,
      [WORKFLOW_TABLES],
    );
    expect(rows).toEqual([]);

    const denied = await asAnon((client) =>
      expectRejection(client.query("select count(*) from public.workflow_instances")),
    );
    expect(denied.code).toBe("42501");
  });

  it("keeps the internal tables out of reach of any session role", async () => {
    const rows = await sql<{ table_name: string; grantee: string }>(
      `select table_name, grantee from information_schema.role_table_grants
       where table_schema = 'btg' and grantee in ('anon','authenticated')
         and table_name in ('workflow_taxonomy','workflow_checks')`,
    );
    expect(rows).toEqual([]);
  });

  it("enables row level security on every workflow table", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])`,
      [WORKFLOW_TABLES],
    );
    expect(rows).toHaveLength(WORKFLOW_TABLES.length);
    for (const row of rows) expect(row.relrowsecurity).toBe(true);
  });

  it("pins search_path on every workflow function", async () => {
    const rows = await sql<{ fn: string }>(
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'btg' and p.proname like '%workflow%'
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                         where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("shows a learner their own run and nobody else's", async () => {
    const learner = await createUser(`wf-rls-own-${nonce()}`);
    const stranger = await createUser(`wf-rls-other-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);

    const mine = await asUser(learner.id, (client) =>
      client.query("select id from public.workflow_instances where id = $1", [instance]),
    );
    expect(mine.rowCount).toBe(1);

    const theirs = await asUser(stranger.id, (client) =>
      client.query("select id from public.workflow_instances where id = $1", [instance]),
    );
    expect(theirs.rowCount).toBe(0);

    const theirItems = await asUser(stranger.id, (client) =>
      client.query(
        "select id from public.workflow_work_items where workflow_instance_id = $1",
        [instance],
      ),
    );
    expect(theirItems.rowCount).toBe(0);
  });

  it("keeps the definition catalog to operators", async () => {
    const learner = await createUser(`wf-rls-def-${nonce()}`);
    const operator = await createUser(`wf-rls-op-${nonce()}`);
    await grantPersonaOperator(operator.id);

    const asLearner = await asUser(learner.id, (client) =>
      client.query("select count(*)::int as n from public.workflow_definitions"),
    );
    expect(asLearner.rows[0].n).toBe(0);

    const asOperator = await asUser(operator.id, (client) =>
      client.query("select count(*)::int as n from public.workflow_definitions"),
    );
    expect(asOperator.rows[0].n).toBeGreaterThan(0);

    const steps = await asUser(learner.id, (client) =>
      client.query("select count(*)::int as n from public.workflow_definition_steps"),
    );
    expect(steps.rows[0].n).toBe(0);
  });

  it("shows a learner the definition their own run pins, and no other", async () => {
    const learner = await createUser(`wf-rls-own-def-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);
    expect(instance).toBeTruthy();

    const visible = await asUser(learner.id, (client) =>
      client.query("select key from public.workflow_definitions order by key"),
    );
    expect(visible.rows.map((r) => r.key)).toEqual(["baseline_diagnostic"]);

    const steps = await asUser(learner.id, (client) =>
      client.query("select distinct step_key from public.workflow_definition_steps order by step_key"),
    );
    expect(steps.rows.map((r) => r.step_key)).toEqual([
      "attempt_scored",
      "attempt_started",
      "baseline_recorded",
    ]);
  });

  it("shows an organization's run to its admin and not to another organization's", async () => {
    const owner = await createUser(`wf-org-owner-${nonce()}`);
    const outsider = await createUser(`wf-org-outsider-${nonce()}`);
    const subject = await createUser(`wf-org-subject-${nonce()}`);
    const org = await createOrganizationAs(owner.id, `wf-org-${nonce()}`);
    await createOrganizationAs(outsider.id, `wf-other-${nonce()}`);

    const instance = await asServiceRole(async (client) => {
      const result = await client.query(
        "select (btg.start_workflow('baseline_diagnostic', $1, $2, $3)).id as id",
        [subject.id, org.id, `org-run:${nonce()}`],
      );
      return result.rows[0].id as string;
    });

    const admin = await asUser(owner.id, (client) =>
      client.query("select id from public.workflow_instances where id = $1", [instance]),
    );
    expect(admin.rowCount).toBe(1);

    const other = await asUser(outsider.id, (client) =>
      client.query("select id from public.workflow_instances where id = $1", [instance]),
    );
    expect(other.rowCount).toBe(0);
  });

  it("leaves the audit ledger unwritable from a session despite the new writer", async () => {
    const learner = await createUser(`wf-ledger-${nonce()}`);
    const rejection = await asUser(learner.id, (client) =>
      expectRejection(
        client.query(
          `select btg.record_workflow_event('workflow.instance.completed','workflow_instance',
             gen_random_uuid()::text)`,
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });
});

describe("no second source of truth", () => {
  it("stores no engine status column anywhere in the workflow tables", async () => {
    const rows = await sql<{ table_name: string; column_name: string; udt_name: string }>(
      `select table_name, column_name, udt_name from information_schema.columns
       where table_schema = 'public'
         and table_name like 'workflow_%'
         and udt_name like 'btg_%'
         and udt_name not in ('btg_workflow_scope','btg_workflow_version_status',
                              'btg_workflow_status','btg_work_item_type',
                              'btg_work_item_status','btg_work_owner_kind',
                              'btg_workflow_handler','btg_persona')`,
    );
    expect(rows).toEqual([]);
  });

  it("references domain entities rather than copying them", async () => {
    const learner = await createUser(`wf-ref-${nonce()}`);
    await completeOnboarding(learner.id);
    const instance = await startBaselineWorkflow(learner.id);
    const attemptId = await startBaseline(learner.id);
    const item = await itemId(instance, "attempt_started");
    await asServiceRole((client) =>
      client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        item,
        attemptId,
      ]),
    );

    const [row] = await sql<{ subject_type: string; subject_id: string; input: unknown }>(
      "select subject_type, subject_id, input from public.workflow_work_items where id = $1",
      [item],
    );
    expect(row).toMatchObject({ subject_type: "diagnostic_attempt", subject_id: attemptId });
    expect(row.input).toEqual({});
  });

  it("bounds a work item's payload", async () => {
    const learner = await createUser(`wf-bound-${nonce()}`);
    const instance = await startBaselineWorkflow(learner.id);
    const item = await itemId(instance, "attempt_started");
    const rejection = await expectRejection(
      sql("update public.workflow_work_items set input = $1 where id = $2", [
        JSON.stringify({ blob: "x".repeat(9000) }),
        item,
      ]),
    );
    expect(rejection.code).toBe("23514");
  });
});
