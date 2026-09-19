import { describe, expect, it } from "vitest";
import {
  asUser,
  createUser,
  expectRejection,
  generatePathwayOnce,
  pathwaySteps,
  sql,
  walkBaseline,
} from "./helpers";

/**
 * Grant-surface certification.
 *
 * These exist because 266 passing tests missed a critical hole: Postgres grants
 * EXECUTE on every function to PUBLIC, and the suite only ever asserted *table*
 * grants. btg.complete_pathway_step is SECURITY DEFINER with no actor check
 * because it is only meant to be reached from inside another governed command;
 * directly callable, it let any learner complete any learner's pathway step.
 */
describe("internal helpers are not reachable from a session", () => {
  const INTERNAL = [
    "btg.complete_pathway_step",
    "btg.maybe_complete_pathway_step",
    "btg.refresh_pathway_unlocks",
    "btg.issue_eligible_credentials",
    "btg.compute_opportunity_matches",
    "btg.notify",
    "btg.handle_new_auth_user",
    "btg.on_project_completed",
    "btg.on_verified_skill_recompute_matches",
    "btg.stamp_onboarding_started",
    "btg.enforce_transition",
    "btg.reject_mutation",
    "btg.assert_transition",
  ];

  it("grants no session role EXECUTE on any internal btg function", async () => {
    const rows = await sql<{ fn: string; anon: boolean; authed: boolean }>(
      `select n.nspname || '.' || p.proname as fn,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'btg' and n.nspname || '.' || p.proname = any($1)`,
      [INTERNAL],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.anon, `anon may execute ${row.fn}`).toBe(false);
      expect(row.authed, `authenticated may execute ${row.fn}`).toBe(false);
    }
  });

  it("keeps the authorization predicates RLS evaluates callable", async () => {
    // Withdrawing these would fail every policy closed instead of open, so the
    // opposite assertion matters just as much.
    const rows = await sql<{ fn: string; authed: boolean }>(
      `select p.proname as fn, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'btg'
         and p.proname in ('is_operator','is_org_admin','is_active_member',
                           'has_platform_persona','governed_org_ids','is_cohort_member',
                           'has_org_persona','current_profile_id')`,
    );
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(row.authed, `RLS needs ${row.fn}`).toBe(true);
  });

  it("refuses a stranger completing another learner's pathway step", async () => {
    const victim = await createUser("grant-victim");
    await walkBaseline(victim.id, { correctly: false });
    const pathwayId = await generatePathwayOnce(victim.id);
    const step = (await pathwaySteps(victim.id, pathwayId)).find((s) => s.status === "available")!;

    const attacker = await createUser("grant-attacker");
    const rejection = await expectRejection(
      asUser(attacker.id, (client) =>
        client.query("select btg.complete_pathway_step($1, $2)", [step.id, "forged"]),
      ),
    );
    expect(rejection.code).toBe("42501");

    const [after] = await sql<{ status: string }>(
      "select status from public.pathway_steps where id = $1",
      [step.id],
    );
    expect(after.status).toBe("available");
  });

  it("refuses a learner issuing themselves credentials directly", async () => {
    const learner = await createUser("grant-credential");
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select btg.issue_eligible_credentials($1)", [learner.id]),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses a learner pushing a notification at another profile", async () => {
    const [a, b] = await Promise.all([createUser("notify-a"), createUser("notify-b")]);
    const rejection = await expectRejection(
      asUser(a.id, (client) =>
        client.query("select btg.notify($1, 'spam', 'Spam', 'spam:1', 'body', '/')", [b.id]),
      ),
    );
    expect(rejection.code).toBe("42501");
  });
});

describe("the ledger is not writable from a session", () => {
  it("refuses a learner writing an audit event directly", async () => {
    // The ledger is the platform's evidence of what happened, and
    // outcome_timeline_view reads it. Before this was closed, a learner could
    // write themselves credential_issued and opportunity_accepted with zero
    // rows in the canonical tables.
    const learner = await createUser("ledger-forger");
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query(
          `select public.record_audit_event(
             'credential.credential.issued', 'credential', gen_random_uuid()::text,
             null, null, null, jsonb_build_object('forged', true),
             'critical'::public.btg_audit_severity, null, 'credentials')`,
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses a learner enqueueing a notification directly", async () => {
    const learner = await createUser("notify-forger");
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query(
          "select public.enqueue_notification($1, 'spam', 'Spam', 'spam:2')",
          [learner.id],
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("marks a notification read and records it, through the command only", async () => {
    const learner = await createUser("notif-reader");
    await walkBaseline(learner.id, { correctly: false });
    const [notification] = await sql<{ id: string }>(
      "select id from public.notifications where profile_id = $1 order by created_at limit 1",
      [learner.id],
    );
    expect(notification).toBeDefined();

    await asUser(learner.id, (client) =>
      client.query("select public.mark_notification_read($1)", [notification.id]),
    );
    const [after] = await sql<{ status: string }>(
      "select status from public.notifications where id = $1",
      [notification.id],
    );
    expect(after.status).toBe("read");

    const ledger = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_events
       where actor_profile_id = $1 and action = 'notification.notification.read'`,
      [learner.id],
    );
    expect(Number(ledger[0].n)).toBe(1);

    // Idempotent: a second call writes no second ledger entry.
    await asUser(learner.id, (client) =>
      client.query("select public.mark_notification_read($1)", [notification.id]),
    );
    const again = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_events
       where actor_profile_id = $1 and action = 'notification.notification.read'`,
      [learner.id],
    );
    expect(Number(again[0].n)).toBe(1);
  });

  it("refuses marking another learner's notification read", async () => {
    const owner = await createUser("notif-owner");
    await walkBaseline(owner.id, { correctly: false });
    const [notification] = await sql<{ id: string }>(
      "select id from public.notifications where profile_id = $1 limit 1",
      [owner.id],
    );
    const stranger = await createUser("notif-stranger");
    const rejection = await expectRejection(
      asUser(stranger.id, (client) =>
        client.query("select public.mark_notification_read($1)", [notification.id]),
      ),
    );
    expect(rejection.code).toBe("P0002");
  });

  it("still records the ledger through the governed commands", async () => {
    // The commands are SECURITY DEFINER and execute as the owner, so closing
    // the caller-facing grant must not have closed the real write path.
    const learner = await createUser("ledger-governed");
    await walkBaseline(learner.id, { correctly: false });
    const rows = await sql<{ action: string }>(
      "select action from public.audit_events where actor_profile_id = $1 and action = 'diagnostic.attempt.scored'",
      [learner.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("leaves no timeline entry a learner could have forged", async () => {
    const learner = await createUser("timeline-clean");
    await walkBaseline(learner.id, { correctly: false });
    const rows = await asUser(learner.id, async (client) => {
      const r = await client.query(
        "select outcome from public.outcome_timeline_view where profile_id = $1",
        [learner.id],
      );
      return r.rows as Array<{ outcome: string }>;
    });
    const reached = rows.map((r) => r.outcome);
    // Nothing downstream of evidence can appear for a learner who only sat a
    // diagnostic.
    for (const forgeable of ["credential_issued", "skill_verified", "opportunity_accepted"]) {
      expect(reached).not.toContain(forgeable);
    }
  });
});

describe("every view resolves RLS as the caller", () => {
  /**
   * The one exception, and why. A view over a table no session role may read
   * returns nothing to everybody under invoker semantics, so it carries
   * definer semantics with the authorization written into the view body
   * instead — the same shape and reason as public.cohort_outcomes. Each entry
   * names the predicate that must appear in the definition, so an exception
   * cannot become a silent hole: dropping the gate fails this test.
   */
  const DEFINER_VIEWS: Record<string, string> = {
    // reads btg.orchestration_events, which is service_role only
    workflow_timeline_view: "is_operator()",
  };

  it("declares security_invoker on every view that can carry it", async () => {
    // A view left on definer semantics would read past the caller's RLS and
    // leak other learners' rows through an innocuous-looking read model.
    const rows = await sql<{ relname: string; invoker: string }>(
      `select c.relname,
              coalesce((select option_value from pg_options_to_table(c.reloptions)
                        where option_name = 'security_invoker'), 'NOT SET') as invoker
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
       order by c.relname`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.relname in DEFINER_VIEWS) continue;
      expect(row.invoker, `${row.relname} is not security_invoker`).toBe("true");
    }
  });

  it("writes the authorization into every view that cannot", async () => {
    for (const [view, predicate] of Object.entries(DEFINER_VIEWS)) {
      const [row] = await sql<{ def: string }>(
        "select pg_get_viewdef($1::regclass) as def",
        [`public.${view}`],
      );
      expect(row.def, `${view} has no inlined authorization`).toContain(predicate);
    }
  });

  it("gives no session role CREATE on a schema", async () => {
    // Without this, a mutable search_path on any function becomes plantable.
    const rows = await sql<{ role: string; schema: string; can: boolean }>(
      `select r.role, s.schema, has_schema_privilege(r.role, s.schema, 'CREATE') as can
       from (values ('anon'),('authenticated')) r(role),
            (values ('public'),('btg')) s(schema)`,
    );
    for (const row of rows) {
      expect(row.can, `${row.role} may CREATE in ${row.schema}`).toBe(false);
    }
  });

  it("pins search_path on every function the linter can reach", async () => {
    const rows = await sql<{ fn: string }>(
      `select n.nspname || '.' || p.proname as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','btg')
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         and (p.proconfig is null or not exists (
               select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
       order by 1`,
    );
    expect(rows.map((r) => r.fn)).toEqual([]);
  });
});

describe("the table grant matrix is the intended one", () => {
  it("gives anon no access to anything in public", async () => {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("gives anon no EXECUTE on any public function", async () => {
    const rows = await sql<{ n: string }>(
      `select count(*)::text as n
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("withholds the answer keys from authenticated entirely", async () => {
    const rows = await sql(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'diagnostic_answer_keys'
         and grantee in ('authenticated','anon')`,
    );
    expect(rows).toEqual([]);
  });

  it("withholds is_correct while allowing the learner's own answers", async () => {
    const cols = await sql<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'diagnostic_responses'
         and grantee = 'authenticated' and privilege_type = 'SELECT'
       order by column_name`,
    );
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("is_correct");
    expect(names).toContain("selected_option_ids");
  });

  it("gives authenticated no write path to any authoritative claim", async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated'
         and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
         and table_name in ('verified_skills','credentials','credential_skills',
                            'learner_competencies','evidence','audit_events',
                            'tutor_turns','tutor_sessions','review_assignments',
                            'review_scores','projects','pathways','pathway_steps',
                            'diagnostic_attempts','diagnostic_responses','applications',
                            'opportunity_matches','mentorships')
       order by table_name, privilege_type`,
    );
    expect(rows).toEqual([]);
  });
});
