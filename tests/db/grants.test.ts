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
