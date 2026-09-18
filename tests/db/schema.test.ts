import { describe, expect, it } from "vitest";
import { asUser, createUser, expectRejection, sql } from "./helpers";
import { DB_STATE_MACHINES } from "@/domain/identity/lifecycle";

const EXPECTED_TABLES = [
  "profiles",
  "organizations",
  "memberships",
  "persona_grants",
  "consents",
  "learner_profiles",
  "audit_events",
  "notifications",
  "notification_preferences",
  "file_objects",
  "competency_domains",
  "competencies",
  "competency_levels",
  "competency_prerequisites",
  "diagnostics",
  "diagnostic_questions",
  "diagnostic_answer_keys",
  "diagnostic_attempts",
  "diagnostic_responses",
  "learner_competencies",
];

describe("schema", () => {
  it("creates every W01 table", async () => {
    const rows = await sql<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const table of EXPECTED_TABLES) expect(names).toContain(table);
  });

  it("enables row level security on every public table", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const unprotected = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  it("gives every table at least one policy", async () => {
    const rows = await sql<{ tablename: string; policies: string }>(
      "select tablename, count(*)::text as policies from pg_policies where schemaname = 'public' group by 1",
    );
    const covered = new Set(rows.map((r) => r.tablename));
    for (const table of EXPECTED_TABLES) expect(covered.has(table)).toBe(true);
  });

  it("keeps the private helper schema out of the API surface", async () => {
    const [row] = await sql<{ has: boolean }>(
      "select has_schema_privilege('anon', 'btg', 'usage') as has",
    );
    expect(row.has).toBe(false);
  });

  it("never grants authenticated a direct write on the audit ledger", async () => {
    const rows = await sql<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated' and table_name = 'audit_events'`,
    );
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(["SELECT"]);
  });

  it("indexes the audit ledger for actor, org and correlation lookups", async () => {
    const rows = await sql<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'audit_events'",
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        "audit_events_actor_idx",
        "audit_events_org_idx",
        "audit_events_correlation_idx",
      ]),
    );
  });
});

describe("state machine parity", () => {
  it("matches btg.state_transitions exactly", async () => {
    const rows = await sql<{ machine: string; from_state: string; to_state: string }>(
      "select machine, from_state, to_state from btg.state_transitions",
    );
    const inDatabase = new Set(rows.map((r) => `${r.machine}:${r.from_state}->${r.to_state}`));
    const inCode = new Set(
      DB_STATE_MACHINES.flatMap((machine) =>
        machine.pairs().map(({ from, to }) => `${machine.name}:${from}->${to}`),
      ),
    );
    expect([...inCode].filter((t) => !inDatabase.has(t))).toEqual([]);
    expect([...inDatabase].filter((t) => !inCode.has(t))).toEqual([]);
  });
});

describe("constraints and immutability", () => {
  it("rejects an onboarding state that skips a step", async () => {
    const user = await createUser("skipper");
    const rejection = await expectRejection(
      sql("update public.profiles set onboarding_state = 'completed' where id = $1", [user.id]),
    );
    expect(rejection.message).toContain("invalid onboarding transition");
  });

  it("rejects a membership transition the machine forbids", async () => {
    const owner = await createUser("owner");
    const [org] = await sql<{ id: string }>(
      `insert into public.organizations (slug, name, type, created_by)
       values ('sch-' || substr(md5(random()::text), 1, 8), 'Schema Org', 'institution', $1) returning id`,
      [owner.id],
    );
    const [membership] = await sql<{ id: string }>(
      `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
       values ($1, $2, 'institution', 'active', now()) returning id`,
      [org.id, owner.id],
    );
    await sql("update public.memberships set status = 'revoked' where id = $1", [membership.id]);
    const rejection = await expectRejection(
      sql("update public.memberships set status = 'active' where id = $1", [membership.id]),
    );
    expect(rejection.message).toContain("invalid membership transition: revoked -> active");
  });

  it("stamps lifecycle timestamps from the transition, not the client", async () => {
    const owner = await createUser("stamper");
    const [org] = await sql<{ id: string }>(
      `insert into public.organizations (slug, name, type, created_by)
       values ('stamp-' || substr(md5(random()::text), 1, 8), 'Stamp Org', 'employer', $1) returning id`,
      [owner.id],
    );
    const [membership] = await sql<{ id: string; activated_at: string | null }>(
      `insert into public.memberships (organization_id, profile_id, persona)
       values ($1, $2, 'employer') returning id, activated_at`,
      [org.id, owner.id],
    );
    expect(membership.activated_at).toBeNull();
    const [updated] = await sql<{ activated_at: string | null }>(
      "update public.memberships set status = 'active' where id = $1 returning activated_at",
      [membership.id],
    );
    expect(updated.activated_at).not.toBeNull();
  });

  it("keeps the audit ledger append-only", async () => {
    const user = await createUser("auditor");
    const [event] = await asUser(user.id, async (client) => {
      const result = await client.query(
        "select public.record_audit_event('identity.session.signed_in', 'session') as id",
      );
      return result.rows as { id: string }[];
    });

    const updateRejection = await expectRejection(
      sql("update public.audit_events set action = 'tampered.value.x' where id = $1", [event.id]),
    );
    expect(updateRejection.message).toContain("append-only");

    const deleteRejection = await expectRejection(
      sql("delete from public.audit_events where id = $1", [event.id]),
    );
    expect(deleteRejection.message).toContain("append-only");
  });

  it("rejects a malformed audit action", async () => {
    const user = await createUser("malformed");
    const rejection = await expectRejection(
      asUser(user.id, (client) =>
        client.query("select public.record_audit_event('NotAnAction', 'session')"),
      ),
    );
    expect(rejection.code).toBe("23514");
  });
});
