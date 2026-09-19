import { describe, expect, it } from "vitest";
import {
  asAnon,
  asServiceRole,
  asUser,
  completeOnboarding,
  createUser,
  expectRejection,
  makeReviewer,
  proveCompetency,
  sql,
  startBaseline,
  walkBaseline,
} from "./helpers";

const nonce = () => Math.random().toString(36).slice(2, 10);

interface DispatchTally {
  claimed: number;
  completed: number;
  waiting: number;
  retried: number;
  failed: number;
  dead: number;
  skipped: number;
}

/**
 * One dispatcher pass. `instanceId` scopes it to one run, which is what a test
 * in a shared database needs: an unscoped pass claims a batch from the whole
 * queue, so another suite's queued work can crowd out this test's item and the
 * tally stops meaning anything.
 */
async function dispatch(
  instanceId?: string,
  worker = `w-${nonce()}`,
  batch = 25,
): Promise<DispatchTally> {
  return asServiceRole(async (client) => {
    const result = await client.query(
      "select * from btg.dispatch_workflow_work($1, $2, 60, $3)",
      [worker, batch, instanceId ?? null],
    );
    const row = result.rows[0];
    return {
      claimed: Number(row.claimed),
      completed: Number(row.completed),
      waiting: Number(row.waiting),
      retried: Number(row.retried),
      failed: Number(row.failed),
      dead: Number(row.dead),
      skipped: Number(row.skipped),
    };
  });
}

/**
 * Dispatches until this instance settles or stops moving. The dispatcher is
 * global by design -- a deployed worker drains the whole queue -- so a test in
 * a shared database asserts on its own instance, never on the batch tally.
 */
async function drainInstance(instanceId: string, maxPasses = 8): Promise<string> {
  let status = await instanceStatus(instanceId);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (["completed", "failed", "cancelled"].includes(status)) break;
    const before = JSON.stringify(await items(instanceId));
    await sql(
      `update btg.work_queue set available_at = now()
       where queue = 'workflow' and status = 'queued'
         and payload->>'instance_id' = $1`,
      [instanceId],
    );
    await dispatch(instanceId);
    status = await instanceStatus(instanceId);
    if (JSON.stringify(await items(instanceId)) === before
        && !["completed", "failed", "cancelled"].includes(status)) {
      // One more pass buys nothing: the run is waiting on something external.
      break;
    }
  }
  return status;
}

/** Simulates a worker that claimed this item's row and then died. */
async function claimAndDie(itemId: string): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `update btg.work_queue set status = 'claimed', attempts = attempts + 1,
       claimed_at = now(), claimed_by = 'dying-worker',
       lease_until = now() - interval '1 minute'
     where id = (select id from btg.work_queue
                 where queue = 'workflow' and status = 'queued'
                   and payload->>'work_item_id' = $1 limit 1)
     returning id::text as id`,
    [itemId],
  );
  return row.id;
}

async function signal(profile: string, subjectType?: string, subjectId?: string): Promise<number> {
  return asServiceRole(async (client) => {
    const result = await client.query(
      "select btg.signal_workflow_subject($1, $2, $3) as n",
      [profile, subjectType ?? null, subjectId ?? null],
    );
    return Number(result.rows[0].n);
  });
}

async function startWorkflow(key: string, profile: string, idem?: string): Promise<string> {
  return asServiceRole(async (client) => {
    const result = await client.query(
      "select (btg.start_workflow($1, $2, null, $3)).id as id",
      [key, profile, idem ?? `${key}:${profile}:${nonce()}`],
    );
    return result.rows[0].id as string;
  });
}

async function items(instanceId: string) {
  return sql<{ id: string; step_key: string; status: string; subject_id: string | null }>(
    `select w.id, w.step_key, w.status::text as status, w.subject_id
     from public.workflow_work_items w
     join public.workflow_instances i on i.id = w.workflow_instance_id
     join public.workflow_definition_steps s
       on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
     where w.workflow_instance_id = $1 order by s.ordinal`,
    [instanceId],
  );
}

async function instanceStatus(instanceId: string): Promise<string> {
  const [row] = await sql<{ status: string }>(
    "select status::text as status from public.workflow_instances where id = $1",
    [instanceId],
  );
  return row.status;
}

async function stream(instanceId: string) {
  return sql<{ event_type: string; step_key: string | null }>(
    `select event_type::text as event_type, step_key from btg.orchestration_events
     where workflow_instance_id = $1 order by occurred_at, event_id`,
    [instanceId],
  );
}

async function queueRows(itemId: string) {
  return sql<{ id: string; status: string; attempts: number }>(
    `select id::text as id, status::text as status, attempts from btg.work_queue
     where queue = 'workflow' and payload->>'work_item_id' = $1`,
    [itemId],
  );
}

/** A throwaway published definition, so probes never touch the seeded catalog. */
async function probeDefinition(
  steps: Array<{
    step_key: string;
    item_type: string;
    handler: string;
    completion_check?: string | null;
    domain_command?: string | null;
    sla_hours?: number | null;
  }>,
): Promise<string> {
  const key = `probe_${nonce()}`;
  const [def] = await sql<{ id: string }>(
    `insert into public.workflow_definitions (key, name, audit_workflow, is_enabled)
     values ($1, 'Probe', 'matching', true) returning id`,
    [key],
  );
  const [version] = await sql<{ id: string }>(
    `insert into public.workflow_definition_versions (definition_id) values ($1) returning id`,
    [def.id],
  );
  let ordinal = 1;
  for (const step of steps) {
    await sql(
      `insert into public.workflow_definition_steps
         (definition_version_id, step_key, ordinal, item_type, handler,
          completion_check, domain_command, sla_hours)
       values ($1, $2, $3, $4::public.btg_work_item_type, $5::public.btg_workflow_handler,
               $6, $7, $8)`,
      [
        version.id,
        step.step_key,
        ordinal,
        step.item_type,
        step.handler,
        step.completion_check ?? null,
        step.domain_command ?? null,
        step.sla_hours ?? null,
      ],
    );
    ordinal += 1;
  }
  await asServiceRole((client) =>
    client.query("select btg.publish_definition_version($1)", [version.id]),
  );
  return key;
}

describe("the orchestration stream", () => {
  it("is append-only", async () => {
    const learner = await createUser(`orc-append-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "one", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [event] = await stream(instance);
    expect(event.event_type).toBe("scheduled");

    const update = await expectRejection(
      sql("update btg.orchestration_events set event_type = 'completed' where workflow_instance_id = $1", [
        instance,
      ]),
    );
    expect(update.code).toBe("23001");

    const remove = await expectRejection(
      sql("delete from btg.orchestration_events where workflow_instance_id = $1", [instance]),
    );
    expect(remove.code).toBe("23001");
  });

  it("cannot be published by any session role", async () => {
    const learner = await createUser(`orc-publish-${nonce()}`);
    const instance = await startWorkflow("baseline_diagnostic", learner.id);

    const asLearner = await asUser(learner.id, (client) =>
      expectRejection(
        client.query(
          `select btg.emit_orchestration_event($1, 'completed', null, 'forged')`,
          [instance],
        ),
      ),
    );
    expect(asLearner.code).toBe("42501");

    const direct = await asUser(learner.id, (client) =>
      expectRejection(
        client.query(
          `insert into btg.orchestration_events
             (workflow_instance_id, event_type, source) values ($1, 'completed', 'forged')`,
          [instance],
        ),
      ),
    );
    expect(direct.code).toBe("42501");

    const visitor = await asAnon((client) =>
      expectRejection(client.query("select count(*) from btg.orchestration_events")),
    );
    expect(visitor.code).toBe("42501");
  });

  it("is not readable by the learner it concerns either", async () => {
    const learner = await createUser(`orc-read-${nonce()}`);
    const instance = await startWorkflow("baseline_diagnostic", learner.id);
    const denied = await asUser(learner.id, (client) =>
      expectRejection(
        client.query("select count(*) from btg.orchestration_events where workflow_instance_id = $1", [
          instance,
        ]),
      ),
    );
    expect(denied.code).toBe("42501");
  });

  it("records execution intent and the queue row in one transaction", async () => {
    const learner = await createUser(`orc-atomic-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "one", item_type: "system", handler: "noop" },
      { step_key: "two", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);
    // The second step is still pending, so an enqueue for it is a real insert;
    // the first was queued when the run started.
    const first = (await items(instance))[1];

    const before = (await stream(instance)).length;
    const beforeQueue = (await queueRows(first.id)).length;

    // Enqueue, then abort. Neither the event nor the queue row may survive.
    await asServiceRole(async (client) => {
      await client.query("savepoint probe");
      await client.query("select btg.enqueue_workflow_step($1, interval '0', 'probe')", [first.id]);
      const mid = await client.query(
        "select count(*)::int as n from btg.orchestration_events where work_item_id = $1 and payload->>'reason' = 'probe'",
        [first.id],
      );
      expect(mid.rows[0].n).toBe(1);
      await client.query("rollback to savepoint probe");
    });

    expect((await stream(instance)).length).toBe(before);
    expect((await queueRows(first.id)).length).toBe(beforeQueue);
  });
});

describe("the domain bridge — the runtime is a worker, never an actor", () => {
  it("refuses a command that is not allowlisted", async () => {
    const rejection = await asServiceRole((client) =>
      expectRejection(
        client.query("select btg.invoke_domain_command('drop_everything', null, null)"),
      ),
    );
    expect(rejection.code).toBe("42501");
    expect(rejection.message).toMatch(/not allowlisted/);
  });

  it("refuses a command that would need a session actor", async () => {
    const learner = await createUser(`bridge-actor-${nonce()}`);
    const rejection = await asServiceRole((client) =>
      expectRejection(
        client.query("select btg.invoke_domain_command('issue_eligible_credentials', $1, null)", [
          learner.id,
        ]),
      ),
    );
    expect(rejection.code).toBe("42501");
    expect(rejection.message).toMatch(/worker, not an actor/);
  });

  it("refuses to even define a step naming such a command", async () => {
    const [def] = await sql<{ id: string }>(
      `insert into public.workflow_definitions (key, name, is_enabled)
       values ($1, 'Probe', false) returning id`,
      [`probe_${nonce()}`],
    );
    const [version] = await sql<{ id: string }>(
      `insert into public.workflow_definition_versions (definition_id) values ($1) returning id`,
      [def.id],
    );
    const rejection = await expectRejection(
      sql(
        `insert into public.workflow_definition_steps
           (definition_version_id, step_key, ordinal, item_type, handler, domain_command)
         values ($1, 'issue', 1, 'system', 'domain_command', 'issue_eligible_credentials')`,
        [version.id],
      ),
    );
    expect(rejection.code).toBe("42501");
    expect(rejection.message).toMatch(/worker, not an actor/);
  });

  it("guards every reference to a session-only writer in a worker-drivable command", async () => {
    /* The writers that raise 28000 without auth.uid() are discovered rather
       than listed, so a new one cannot slip past this. A worker-drivable
       command may reference one only behind a guard on auth.uid(); the first
       version of this guard looked for record_audit_event alone and missed
       enqueue_notification, which is defect 20. */
    const writers = await sql<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','btg')
         and p.prosrc like '%requires an authenticated actor%'`,
    );
    expect(writers.map((w) => w.name).sort()).toEqual([
      "enqueue_notification",
      "record_audit_event",
    ]);

    const offenders = await sql<{ name: string; writer: string }>(
      `select c.name, w.proname as writer
       from btg.workflow_commands c
       join pg_proc p on p.proname = c.name
       join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'btg'
       cross join lateral (
         select wp.proname from pg_proc wp join pg_namespace wn on wn.oid = wp.pronamespace
         where wn.nspname in ('public','btg')
           and wp.prosrc like '%requires an authenticated actor%'
       ) w
       where not c.requires_session_actor
         and p.prosrc like '%' || w.proname || '%'
         and p.prosrc not like '%auth.uid() is not null%'`,
    );
    expect(offenders).toEqual([]);
  });

  it("records an empty plan as an outcome too", async () => {
    const learner = await createUser(`bridge-empty-${nonce()}`);
    await completeOnboarding(learner.id);
    // Everything answered correctly: no gaps, so the engine has nothing to
    // close and produces a legitimately empty pathway.
    await walkBaseline(learner.id, { correctly: true });

    await asServiceRole((client) =>
      client.query("select btg.generate_pathway_for($1)", [learner.id]),
    );

    const [pathway] = await sql<{ status: string; steps: string }>(
      `select p.status::text as status,
              (select count(*)::text from public.pathway_steps s where s.pathway_id = p.id) as steps
       from public.pathways p where p.profile_id = $1 and p.status = 'active'`,
      [learner.id],
    );
    expect(pathway.status).toBe("active");
    expect(pathway.steps).toBe("0");

    // The defect: this branch used to leave no evidence at all.
    const timeline = await asUser(learner.id, (client) =>
      client.query(
        "select outcome from public.outcome_timeline_view where profile_id = $1 and outcome = 'pathway_generated'",
        [learner.id],
      ),
    );
    expect(timeline.rowCount).toBe(1);

    // And a workflow waiting on the pathway is satisfied by it.
    const satisfied = await asServiceRole(async (client) => {
      const r = await client.query(
        "select btg.assert_step_satisfied('learner_has_active_pathway', null, null, $1) as ok",
        [learner.id],
      );
      return r.rows[0].ok as boolean;
    });
    expect(satisfied).toBe(true);
  });

  it("runs every worker-drivable command with no session at all", async () => {
    /* The behavioural half: a static scan proves a shape, this proves the
       thing actually works as a worker runs it. drain_notifications is left
       out of the loop because invoking it drains every learner's pending
       notification, which would reach into other suites; the W14-B execution
       tier already drives it with no session in tests/db/execution.test.ts. */
    const learner = await createUser(`bridge-loop-${nonce()}`);
    await completeOnboarding(learner.id);
    await walkBaseline(learner.id, { correctly: false });

    const commands = await sql<{ name: string }>(
      `select name from btg.workflow_commands
       where not requires_session_actor and name <> 'drain_notifications'
       order by name`,
    );
    expect(commands.length).toBeGreaterThanOrEqual(2);

    for (const { name } of commands) {
      await asServiceRole((client) =>
        client.query("select btg.invoke_domain_command($1, $2, null)", [name, learner.id]),
      );
    }
  });

  it("drives the pathway engine with no session at all", async () => {
    // The behavioural half of the guard above: the extracted engine command
    // runs as the worker runs it, with auth.uid() null.
    const learner = await createUser(`bridge-nosession-${nonce()}`);
    await completeOnboarding(learner.id);
    // Answered wrongly on purpose: a learner already at target gets an empty
    // plan, which is a different (also recorded) branch of the engine.
    await walkBaseline(learner.id, { correctly: false });

    const result = await asServiceRole(async (client) => {
      const r = await client.query(
        "select (btg.generate_pathway_for($1)).status::text as status",
        [learner.id],
      );
      return r.rows[0].status as string;
    });
    expect(result).toBe("active");

    // Recorded as the runtime's action, about the learner.
    const [event] = await sql<{ actor_profile_id: string | null; subject: string; actor: string }>(
      `select actor_profile_id, metadata->>'subject' as subject, metadata->>'actor' as actor
       from public.audit_events
       where action = 'pathway.pathway.generated'
         and metadata->>'subject' = $1`,
      [learner.id],
    );
    expect(event.actor_profile_id).toBeNull();
    expect(event.actor).toBe("workflow_runtime");

    // And the learner still sees it on their own timeline.
    const timeline = await asUser(learner.id, (client) =>
      client.query(
        "select outcome from public.outcome_timeline_view where profile_id = $1 and outcome = 'pathway_generated'",
        [learner.id],
      ),
    );
    expect(timeline.rowCount).toBe(1);
  });

  it("refuses a command needing a subject when the instance has none", async () => {
    const rejection = await asServiceRole((client) =>
      expectRejection(
        client.query("select btg.invoke_domain_command('compute_opportunity_matches', null, null)"),
      ),
    );
    expect(rejection.code).toBe("23514");
  });

  it("names only allowlisted commands anywhere in the catalog", async () => {
    const rows = await sql<{ step_key: string }>(
      `select step_key from public.workflow_definition_steps s
       where s.domain_command is not null
         and s.domain_command not in (select name from btg.workflow_commands)`,
    );
    expect(rows).toEqual([]);
  });
});

describe("the dispatcher drives a run", () => {
  it("carries the baseline diagnostic to completion through signals alone", async () => {
    const learner = await createUser(`disp-journey-${nonce()}`);
    await completeOnboarding(learner.id);
    const instance = await startWorkflow("baseline_diagnostic", learner.id);

    // The first step needs an entity nobody has named yet, so it is not queued:
    // dispatching it would raise and burn a retry.
    const initial = await items(instance);
    expect(initial[0].status).toBe("ready");
    expect(initial[0].subject_id).toBeNull();
    expect(await queueRows(initial[0].id)).toEqual([]);

    // The learner acts, in their own session, through the governed command.
    const attemptId = await startBaseline(learner.id);
    // One signal binds every step of the run that names this entity, not just
    // the one whose turn it is.
    expect(await signal(learner.id, "diagnostic_attempt", attemptId)).toBeGreaterThanOrEqual(1);

    // The signal bound the step to the attempt and queued it.
    expect((await items(instance))[0].subject_id).toBe(attemptId);
    await dispatch(instance);

    // Step two waits for the same attempt to be scored.
    expect((await items(instance)).map((i) => i.status)).toEqual([
      "completed",
      "ready",
      "pending",
    ]);

    const { attemptId: walked } = await walkBaseline(learner.id, { correctly: true });
    expect(walked).toBe(attemptId);
    expect(await signal(learner.id, "diagnostic_attempt", attemptId)).toBeGreaterThanOrEqual(1);

    expect(await drainInstance(instance)).toBe("completed");
    expect((await items(instance)).map((i) => i.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);

    const events = (await stream(instance)).map((e) => e.event_type);
    expect(events).toContain("signalled");
    expect(events).toContain("claimed");
    expect(events).toContain("handler_resolved");
    expect(events.filter((e) => e === "completed")).toHaveLength(3);
    expect(events).not.toContain("failed");
    expect(events).not.toContain("dead_lettered");
  });

  it("invokes an allowlisted domain command and re-verifies the domain", async () => {
    const learner = await createUser(`disp-cmd-${nonce()}`);
    const reviewer = await makeReviewer(`disp-rev-${nonce()}`);
    await completeOnboarding(learner.id);
    await proveCompetency(learner.id, reviewer.id, "brief-prompt-design");

    const instance = await startWorkflow("matching", learner.id);

    // Step one awaits the verified skill; step two is the domain command.
    expect(await drainInstance(instance)).toBe("completed");
    expect((await items(instance)).map((i) => i.status)).toEqual(["completed", "completed"]);

    const [invoked] = await sql<{ command: string; matches: number }>(
      `select payload->'result'->>'command' as command,
              (payload->'result'->>'matches')::int as matches
       from btg.orchestration_events
       where workflow_instance_id = $1 and event_type = 'domain_command_invoked'`,
      [instance],
    );
    expect(invoked.matches).toBeGreaterThan(0);

    const [{ n }] = await sql<{ n: string }>(
      "select count(*)::text as n from public.opportunity_matches where profile_id = $1",
      [learner.id],
    );
    expect(Number(n)).toBeGreaterThan(0);
  });

  it("resolves a person's work by parking it, and refuses what no worker can do", async () => {
    // W14-E flipped human_review and approval to resolvable: the dispatcher
    // knows what to do with them, which is to park them for their owner. The
    // classes with no worker behind them stay refused at start time.
    const rows = await sql<{ handler: string; is_resolvable: boolean }>(
      `select handler::text as handler, is_resolvable from btg.workflow_handlers
       order by handler::text`,
    );
    const byHandler = Object.fromEntries(rows.map((r) => [r.handler, r.is_resolvable]));
    expect(byHandler).toMatchObject({
      noop: true,
      await_domain_state: true,
      domain_command: true,
      timer: true,
      human_review: true,
      approval: true,
      ai_worker: false,
      external_call: false,
    });
  });

  it("skips work whose instance has already settled", async () => {
    const learner = await createUser(`disp-settled-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "marker", item_type: "system", handler: "noop" },
      { step_key: "second", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);
    await asServiceRole((client) =>
      client.query("select btg.cancel_workflow($1, 'probe')", [instance]),
    );

    const tally = await dispatch(instance);
    expect(tally.skipped).toBeGreaterThanOrEqual(1);
    expect(await instanceStatus(instance)).toBe("cancelled");
    expect((await items(instance)).map((i) => i.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("completes a noop chain in one pass per step", async () => {
    const learner = await createUser(`disp-noop-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "one", item_type: "system", handler: "noop" },
      { step_key: "two", item_type: "system", handler: "noop" },
      { step_key: "three", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);

    expect(await drainInstance(instance)).toBe("completed");
    expect((await items(instance)).map((i) => i.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
  });
});

describe("durable waits", () => {
  it("re-checks on a widening interval rather than spinning", async () => {
    const learner = await createUser(`wait-backoff-${nonce()}`);
    const key = await probeDefinition([
      {
        step_key: "needs_a_skill",
        item_type: "wait",
        handler: "await_domain_state",
        completion_check: "learner_has_verified_skill",
      },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    const delays: number[] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      // Bring the paced re-check forward so the test does not wait minutes.
      await sql(
        `update btg.work_queue set available_at = now()
         where queue = 'workflow' and status = 'queued' and payload->>'work_item_id' = $1`,
        [item.id],
      );
      const tally = await dispatch(instance);
      expect(tally.waiting).toBeGreaterThanOrEqual(1);
      const [latest] = await sql<{ seconds: number }>(
        `select (payload->>'recheck_in_seconds')::int as seconds
         from btg.orchestration_events
         where work_item_id = $1 and event_type = 'awaiting_domain_state'
         order by occurred_at desc limit 1`,
        [item.id],
      );
      delays.push(latest.seconds);
    }
    expect(delays).toEqual([30, 60, 120]);
    expect(await instanceStatus(instance)).toBe("waiting");
  });

  it("ends the wait on a signal instead of on the next re-check", async () => {
    const learner = await createUser(`wait-signal-${nonce()}`);
    const reviewer = await makeReviewer(`wait-rev-${nonce()}`);
    await completeOnboarding(learner.id);
    const key = await probeDefinition([
      {
        step_key: "needs_a_skill",
        item_type: "wait",
        handler: "await_domain_state",
        completion_check: "learner_has_verified_skill",
      },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    await dispatch(instance);
    const [queued] = await sql<{ id: string }>(
      `select id::text as id from btg.work_queue
       where queue = 'workflow' and status = 'queued' and payload->>'work_item_id' = $1`,
      [item.id],
    );
    const [{ future }] = await sql<{ future: boolean }>(
      "select available_at > now() as future from btg.work_queue where id = $1",
      [queued.id],
    );
    expect(future).toBe(true);

    await proveCompetency(learner.id, reviewer.id, "brief-prompt-design");
    expect(await signal(learner.id)).toBe(1);

    const [{ future: after }] = await sql<{ future: boolean }>(
      "select available_at > now() as future from btg.work_queue where id = $1",
      [queued.id],
    );
    expect(after).toBe(false);

    expect(await drainInstance(instance)).toBe("completed");
  });

  it("scopes a signal to one learner", async () => {
    const learner = await createUser(`wait-scope-a-${nonce()}`);
    const stranger = await createUser(`wait-scope-b-${nonce()}`);
    const key = await probeDefinition([
      {
        step_key: "needs_a_skill",
        item_type: "wait",
        handler: "await_domain_state",
        completion_check: "learner_has_verified_skill",
      },
    ]);
    const instance = await startWorkflow(key, learner.id);
    expect(instance).toBeTruthy();

    // A signal for somebody else touches nothing.
    expect(await signal(stranger.id)).toBe(0);

    const rejection = await asServiceRole((client) =>
      expectRejection(client.query("select btg.signal_workflow_subject(null, null, null)")),
    );
    expect(rejection.code).toBe("23514");
  });

  it("fails a wait that passes its deadline", async () => {
    const learner = await createUser(`wait-deadline-${nonce()}`);
    const key = await probeDefinition([
      {
        step_key: "needs_a_skill",
        item_type: "wait",
        handler: "await_domain_state",
        completion_check: "learner_has_verified_skill",
        sla_hours: 1,
      },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    await sql(
      "update public.workflow_work_items set deadline_at = now() - interval '1 minute' where id = $1",
      [item.id],
    );
    await sql(
      `update btg.work_queue set available_at = now()
       where queue = 'workflow' and status = 'queued' and payload->>'work_item_id' = $1`,
      [item.id],
    );

    await dispatch(instance);
    expect(await instanceStatus(instance)).toBe("failed");
    const [{ failure }] = await sql<{ failure: string }>(
      "select failure from public.workflow_work_items where id = $1",
      [item.id],
    );
    expect(failure).toMatch(/deadline passed/);
  });
});

describe("crash and replay", () => {
  it("leaves work queued when the worker dies before claiming", async () => {
    const learner = await createUser(`crash-preclaim-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "one", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    const [row] = await queueRows(item.id);
    expect(row).toMatchObject({ status: "queued", attempts: 0 });

    // A later pass picks it up untouched.
    expect(await drainInstance(instance)).toBe("completed");
  });

  it("returns leased work after the lease expires, with the attempt spent", async () => {
    const learner = await createUser(`crash-lease-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "one", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    // Claim it, then vanish with the lease already past.
    await claimAndDie(item.id);
    let [row] = (await queueRows(item.id)).filter((r) => r.status === "claimed");
    expect(row).toMatchObject({ status: "claimed", attempts: 1 });

    const reaped = await asServiceRole(async (client) => {
      const result = await client.query("select btg.reap_expired_leases() as n");
      return Number(result.rows[0].n);
    });
    expect(reaped).toBeGreaterThanOrEqual(1);

    // Back on the queue with the attempt already spent: a dead worker gets no
    // free retry.
    [row] = (await queueRows(item.id)).filter((r) => r.status === "queued");
    expect(row).toMatchObject({ status: "queued", attempts: 1 });

    expect(await drainInstance(instance)).toBe("completed");
  });

  it("enqueues once under duplicate delivery", async () => {
    const learner = await createUser(`crash-dup-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "one", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    const second = await asServiceRole(async (client) => {
      const result = await client.query(
        "select btg.enqueue_workflow_step($1, interval '0', 'duplicate') as id",
        [item.id],
      );
      return result.rows[0].id;
    });
    expect(second).toBeNull();
    expect(await queueRows(item.id)).toHaveLength(1);
  });

  it("applies no duplicate domain effect when a worker dies after the command succeeds", async () => {
    const learner = await createUser(`crash-postcmd-${nonce()}`);
    const reviewer = await makeReviewer(`crash-rev-${nonce()}`);
    await completeOnboarding(learner.id);
    await proveCompetency(learner.id, reviewer.id, "brief-prompt-design");

    const key = await probeDefinition([
      {
        step_key: "recompute",
        item_type: "system",
        handler: "domain_command",
        domain_command: "compute_opportunity_matches",
        completion_check: "learner_has_opportunity_match",
      },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    // Simulate the crash: the row is claimed, the command succeeds, and the
    // worker dies before acknowledging.
    await claimAndDie(item.id);
    await asServiceRole((client) =>
      client.query("select btg.invoke_domain_command('compute_opportunity_matches', $1, null)", [
        learner.id,
      ]),
    );
    const [{ n: afterCrash }] = await sql<{ n: string }>(
      "select count(*)::text as n from public.opportunity_matches where profile_id = $1",
      [learner.id],
    );
    expect(Number(afterCrash)).toBeGreaterThan(0);

    // The lease is reaped and the work runs again -- to the same domain state.
    await asServiceRole((client) => client.query("select btg.reap_expired_leases()"));
    expect(await drainInstance(instance)).toBe("completed");

    const [{ n: afterReplay }] = await sql<{ n: string }>(
      "select count(*)::text as n from public.opportunity_matches where profile_id = $1",
      [learner.id],
    );
    expect(afterReplay).toBe(afterCrash);
  });

  it("hands one queue row to exactly one of two concurrent workers", async () => {
    const learner = await createUser(`crash-concurrent-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "one", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    const [first, second] = await Promise.all([
      asServiceRole(async (client) => {
        const r = await client.query(
          "select count(*)::int as n from btg.claim_work('workflow', 'worker-a', 60, 50)",
        );
        return r.rows[0].n as number;
      }),
      asServiceRole(async (client) => {
        const r = await client.query(
          "select count(*)::int as n from btg.claim_work('workflow', 'worker-b', 60, 50)",
        );
        return r.rows[0].n as number;
      }),
    ]);

    const [{ claimed_by }] = await sql<{ claimed_by: string }>(
      `select claimed_by from btg.work_queue
       where queue = 'workflow' and payload->>'work_item_id' = $1`,
      [item.id],
    );
    expect(["worker-a", "worker-b"]).toContain(claimed_by);
    // The row went to one worker, never both.
    expect(first + second).toBeGreaterThanOrEqual(1);
    const [{ n }] = await sql<{ n: string }>(
      `select count(*)::text as n from btg.work_queue
       where queue = 'workflow' and payload->>'work_item_id' = $1 and status = 'claimed'`,
      [item.id],
    );
    expect(Number(n)).toBe(1);
    expect(instance).toBeTruthy();
  });

  it("rolls back a domain command whose completion the domain then refuses, and never duplicates it", async () => {
    const learner = await createUser(`crash-rollback-${nonce()}`);
    await completeOnboarding(learner.id);
    const attemptId = await startBaseline(learner.id);

    // The command succeeds; the completion check then fails, because the
    // attempt this step is bound to is still in progress. Both must roll back.
    const key = await probeDefinition([
      {
        step_key: "recompute",
        item_type: "system",
        handler: "domain_command",
        domain_command: "compute_opportunity_matches",
        completion_check: "diagnostic_attempt_scored",
      },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);
    await asServiceRole((client) =>
      client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        item.id,
        attemptId,
      ]),
    );

    for (let pass = 0; pass < 6; pass += 1) {
      await sql(
        `update btg.work_queue set available_at = now()
         where queue = 'workflow' and status = 'queued' and payload->>'work_item_id' = $1`,
        [item.id],
      );
      const tally = await dispatch(instance);
      if (tally.dead > 0) break;
      expect(tally.retried).toBeGreaterThanOrEqual(1);
    }

    // Every attempt rolled back: the command wrote nothing that survived.
    const [{ n }] = await sql<{ n: string }>(
      "select count(*)::text as n from public.opportunity_matches where profile_id = $1",
      [learner.id],
    );
    expect(Number(n)).toBe(0);

    const events = (await stream(instance)).map((e) => e.event_type);
    expect(events).toContain("retry_scheduled");
    expect(events).toContain("dead_lettered");
    expect(events).not.toContain("completed");
    expect(await instanceStatus(instance)).toBe("failed");
  });

  it("dead-letters a poison item after the attempt ceiling", async () => {
    const learner = await createUser(`crash-poison-${nonce()}`);
    const key = await probeDefinition([
      {
        step_key: "mis_bound",
        item_type: "system",
        handler: "await_domain_state",
        completion_check: "diagnostic_attempt_scored",
      },
    ]);
    const instance = await startWorkflow(key, learner.id);
    const [item] = await items(instance);

    // Point the step at the wrong kind of entity: the check refuses to run.
    await asServiceRole((client) =>
      client.query("select btg.bind_work_item_subject($1, 'pathway', $2)", [item.id, learner.id]),
    );
    await asServiceRole((client) =>
      client.query("select btg.enqueue_workflow_step($1, interval '0', 'poison probe')", [item.id]),
    );

    let dead = 0;
    for (let pass = 0; pass < 8 && dead === 0; pass += 1) {
      await sql(
        `update btg.work_queue set available_at = now()
         where queue = 'workflow' and status = 'queued' and payload->>'work_item_id' = $1`,
        [item.id],
      );
      const tally = await dispatch(instance);
      dead = tally.dead;
    }
    expect(dead).toBe(1);

    const dead_rows = (await queueRows(item.id)).filter((r) => r.status === "dead");
    expect(dead_rows).toHaveLength(1);
    const [{ status }] = await sql<{ status: string }>(
      "select status::text as status from public.workflow_work_items where id = $1",
      [item.id],
    );
    expect(status).toBe("failed");
    expect(await instanceStatus(instance)).toBe("failed");
  });
});

describe("no second queue, and the runtime's security boundary", () => {
  it("adds no queue: the dispatcher claims from btg.work_queue", async () => {
    const rows = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'btg' and table_type = 'BASE TABLE'
         and table_name like '%queue%' order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(["work_queue"]);
  });

  it("gives no session role EXECUTE on any orchestration function", async () => {
    const fns = [
      "btg.emit_orchestration_event(uuid, public.btg_orchestration_event, uuid, text, jsonb, integer, text, text)",
      "btg.enqueue_workflow_step(uuid, interval, text)",
      "btg.enqueue_ready_steps(uuid)",
      "btg.invoke_domain_command(text, uuid, uuid)",
      "btg.signal_workflow_subject(uuid, text, uuid)",
      "btg.dispatch_workflow_work(text, integer, integer, uuid)",
      "btg.claim_workflow_items(text, integer, integer, uuid)",
      "btg.generate_pathway_for(uuid, uuid)",
      "btg.abandon_work_item(uuid, text)",
      "btg.start_workflow(text, uuid, uuid, text)",
      "btg.assert_step_satisfied(text, text, uuid, uuid)",
    ];
    for (const fn of fns) {
      const [row] = await sql<{ anon: boolean; authed: boolean; worker: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authed,
                has_function_privilege('service_role', $1, 'execute') as worker`,
        [fn],
      );
      expect({ fn, ...row }).toEqual({ fn, anon: false, authed: false, worker: true });
    }
  });

  it("keeps the allowlists and the stream out of reach of any session role", async () => {
    const rows = await sql<{ table_name: string; grantee: string }>(
      `select table_name, grantee from information_schema.role_table_grants
       where table_schema = 'btg' and grantee in ('anon','authenticated')
         and table_name in ('orchestration_events','workflow_commands','workflow_handlers')`,
    );
    expect(rows).toEqual([]);
  });

  it("pins search_path on every orchestration function", async () => {
    const rows = await sql<{ fn: string }>(
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'btg'
         and (p.proname like '%orchestration%' or p.proname like '%workflow%'
              or p.proname like '%domain_command%' or p.proname like '%ready_steps%')
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                         where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("never lets one learner's run reach another learner's domain state", async () => {
    const learner = await createUser(`iso-a-${nonce()}`);
    const stranger = await createUser(`iso-b-${nonce()}`);
    await completeOnboarding(stranger.id);
    const { attemptId: strangersAttempt } = await walkBaseline(stranger.id, { correctly: true });

    const instance = await startWorkflow("baseline_diagnostic", learner.id);
    const [item] = await items(instance);
    await asServiceRole((client) =>
      client.query("select btg.bind_work_item_subject($1, 'diagnostic_attempt', $2)", [
        item.id,
        strangersAttempt,
      ]),
    );
    await asServiceRole((client) =>
      client.query("select btg.enqueue_workflow_step($1, interval '0', 'isolation probe')", [item.id]),
    );

    await dispatch(instance);
    // The check reads the instance's own subject_profile_id, so the stranger's
    // attempt simply is not there to find: a wait, never a completion.
    expect((await items(instance))[0].status).toBe("ready");
    expect(await instanceStatus(instance)).not.toBe("completed");
  });

  it("records the runtime as the actor of its own ledger entries", async () => {
    const learner = await createUser(`iso-actor-${nonce()}`);
    const key = await probeDefinition([
      { step_key: "one", item_type: "system", handler: "noop" },
    ]);
    const instance = await startWorkflow(key, learner.id);
    await dispatch(instance);

    const events = await sql<{ actor_profile_id: string | null; actor: string }>(
      `select actor_profile_id, metadata->>'actor' as actor from public.audit_events
       where object_id = $1 and action like 'workflow.%'`,
      [instance],
    );
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.actor_profile_id).toBeNull();
      expect(event.actor).toBe("workflow_runtime");
    }
  });
});
