import { describe, expect, it } from "vitest";
import {
  asUser,
  createOrganizationAs,
  createUser,
  expectRejection,
  grantPersona,
  sql,
  walkBaseline,
} from "./helpers";

describe("profile visibility", () => {
  it("lets a learner read only its own profile", async () => {
    const [ada, ben] = await Promise.all([createUser("ada"), createUser("ben")]);
    const rows = await asUser(ada.id, async (client) => {
      const result = await client.query("select id from public.profiles where id = any($1::uuid[])", [
        [ada.id, ben.id],
      ]);
      return result.rows as { id: string }[];
    });
    expect(rows.map((r) => r.id)).toEqual([ada.id]);
  });

  it("refuses a learner writing another learner's profile", async () => {
    const [ada, ben] = await Promise.all([createUser("ada"), createUser("ben")]);
    const updated = await asUser(ada.id, async (client) => {
      const result = await client.query(
        "update public.profiles set headline = 'hijacked' where id = $1 returning id",
        [ben.id],
      );
      return result.rowCount;
    });
    expect(updated).toBe(0);
  });

  it("lets an operator read any profile", async () => {
    const [ada, root] = await Promise.all([createUser("ada"), createUser("root")]);
    await grantPersona(root.id, "operator");
    const rows = await asUser(root.id, async (client) => {
      const result = await client.query("select id from public.profiles where id = $1", [ada.id]);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });

  it("lets an organization admin read its own members but not outsiders", async () => {
    const [admin, member, outsider] = await Promise.all([
      createUser("admin"),
      createUser("member"),
      createUser("outsider"),
    ]);
    const org = await createOrganizationAs(admin.id, "Visible Uni");
    await sql(
      `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
       values ($1, $2, 'mentor', 'active', now())`,
      [org.id, member.id],
    );

    const visible = await asUser(admin.id, async (client) => {
      const result = await client.query("select id from public.profiles where id = any($1::uuid[])", [
        [member.id, outsider.id],
      ]);
      return (result.rows as { id: string }[]).map((r) => r.id);
    });
    expect(visible).toEqual([member.id]);
  });

  it("does not let a plain member read other members' profiles", async () => {
    const [admin, mentor, other] = await Promise.all([
      createUser("admin"),
      createUser("mentor"),
      createUser("other"),
    ]);
    const org = await createOrganizationAs(admin.id, "Closed Uni");
    await sql(
      `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
       values ($1, $2, 'mentor', 'active', now()), ($1, $3, 'mentor', 'active', now())`,
      [org.id, mentor.id, other.id],
    );
    const visible = await asUser(mentor.id, async (client) => {
      const result = await client.query("select id from public.profiles where id = $1", [other.id]);
      return result.rowCount;
    });
    expect(visible).toBe(0);
  });
});

describe("reviewer visibility is narrow", () => {
  it("lets a learner see who reviewed their own evidence, and no one else", async () => {
    const { makeReviewer, proveCompetency, walkBaseline } = await import("./helpers");
    const [learnerA, learnerB, reviewer] = await Promise.all([
      createUser("vis-a"),
      createUser("vis-b"),
      makeReviewer("vis-reviewer"),
    ]);
    await walkBaseline(learnerA.id, { correctly: false });
    await proveCompetency(learnerA.id, reviewer.id, "brief-ai-concepts");

    // A saw their reviewer.
    const seenByA = await asUser(learnerA.id, async (client) => {
      const result = await client.query("select id from public.profiles where id = $1", [reviewer.id]);
      return result.rowCount;
    });
    expect(seenByA).toBe(1);

    // B, who has no review by this reviewer, still cannot.
    const seenByB = await asUser(learnerB.id, async (client) => {
      const result = await client.query("select id from public.profiles where id = $1", [reviewer.id]);
      return result.rowCount;
    });
    expect(seenByB).toBe(0);

    // And A still cannot read an unrelated learner.
    const crossRead = await asUser(learnerA.id, async (client) => {
      const result = await client.query("select id from public.profiles where id = $1", [learnerB.id]);
      return result.rowCount;
    });
    expect(crossRead).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("hides one organization's members from another organization's admin", async () => {
    const [adminA, adminB, memberB] = await Promise.all([
      createUser("admin-a"),
      createUser("admin-b"),
      createUser("member-b"),
    ]);
    const orgB = await createOrganizationAs(adminB.id, "Org B", "employer");
    await sql(
      `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
       values ($1, $2, 'reviewer', 'active', now())`,
      [orgB.id, memberB.id],
    );
    await createOrganizationAs(adminA.id, "Org A", "employer");

    const seen = await asUser(adminA.id, async (client) => {
      const result = await client.query("select id from public.memberships where organization_id = $1", [
        orgB.id,
      ]);
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });

  it("refuses an outsider inviting themselves into an organization", async () => {
    const [admin, intruder] = await Promise.all([createUser("admin"), createUser("intruder")]);
    const org = await createOrganizationAs(admin.id, "Guarded Uni");
    const rejection = await expectRejection(
      asUser(intruder.id, (client) =>
        client.query(
          "insert into public.memberships (organization_id, profile_id, persona) values ($1, $2, 'institution')",
          [org.id, intruder.id],
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses an admin activating a membership in an organization it does not govern", async () => {
    const [adminA, adminB, memberB] = await Promise.all([
      createUser("admin-a"),
      createUser("admin-b"),
      createUser("member-b"),
    ]);
    const orgB = await createOrganizationAs(adminB.id, "Org B2", "sponsor");
    const [membership] = await sql<{ id: string }>(
      `insert into public.memberships (organization_id, profile_id, persona)
       values ($1, $2, 'mentor') returning id`,
      [orgB.id, memberB.id],
    );
    await createOrganizationAs(adminA.id, "Org A2", "sponsor");

    const affected = await asUser(adminA.id, async (client) => {
      const result = await client.query("update public.memberships set status = 'active' where id = $1", [
        membership.id,
      ]);
      return result.rowCount;
    });
    expect(affected).toBe(0);
  });
});

describe("privilege escalation", () => {
  it("refuses a learner granting itself the operator persona", async () => {
    const learner = await createUser("climber");
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query(
          "insert into public.persona_grants (profile_id, persona, status) values ($1, 'operator', 'active')",
          [learner.id],
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses a learner writing the audit ledger directly", async () => {
    const learner = await createUser("forger");
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query(
          `insert into public.audit_events (actor_profile_id, action, object_type)
           values ($1, 'identity.session.signed_in', 'session')`,
          [learner.id],
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  /* Migration 20260918003800 closed the caller-facing grant on
     record_audit_event, because it let any session write arbitrary lifecycle
     actions into the ledger. The property these tests exist for -- that the
     actor is stamped from the session and cannot be supplied -- is unchanged,
     so they now assert it through a governed command instead of by calling the
     writer directly. That the writer is unreachable is asserted in
     tests/db/grants.test.ts. */
  it("stamps the audit actor from the session, so it cannot be forged", async () => {
    const [ada, ben] = await Promise.all([createUser("ada"), createUser("ben")]);
    await walkBaseline(ada.id, { correctly: false });

    const events = await sql<{ actor_profile_id: string }>(
      `select actor_profile_id from public.audit_events
       where action = 'diagnostic.attempt.scored' and actor_profile_id = $1`,
      [ada.id],
    );
    expect(events).toHaveLength(1);
    expect(events[0].actor_profile_id).toBe(ada.id);
    // Nothing Ada did could attribute a diagnostic event to Ben. Ben has his
    // own signup event, written by the auth trigger under his own id, which is
    // exactly the attribution being asserted.
    const bens = await sql<{ action: string }>(
      "select action from public.audit_events where actor_profile_id = $1 order by action",
      [ben.id],
    );
    expect(bens.map((b) => b.action)).toEqual(["identity.session.signed_up"]);
  });

  it("refuses an audit event with no session", async () => {
    // Called as the owner, which holds EXECUTE, with no request claim set.
    const rejection = await expectRejection(
      sql("select public.record_audit_event('identity.session.signed_in', 'session')"),
    );
    expect(rejection.code).toBe("28000");
  });
});

describe("notifications", () => {
  it("keeps an inbox private to its owner", async () => {
    const [ada, ben] = await Promise.all([createUser("ada"), createUser("ben")]);
    // Seeded the way a real notification arrives: from a governed command.
    await walkBaseline(ada.id, { correctly: false });
    const seen = await asUser(ben.id, async (client) => {
      const result = await client.query("select id from public.notifications where profile_id = $1", [ada.id]);
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });

  it("refuses notifying another profile", async () => {
    const [ada, ben] = await Promise.all([createUser("ada"), createUser("ben")]);
    const rejection = await expectRejection(
      asUser(ada.id, (client) =>
        client.query("select public.enqueue_notification($1, 'test.spam', 'Spam', 'k-spam')", [ben.id]),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("is idempotent for a repeated domain event", async () => {
    const ada = await createUser("ada");
    // btg.notify is the path every command uses. It is granted to no session
    // role, so this runs as the owner, exactly as a definer command does.
    const ids = await sql<{ id: string }>(
      `select btg.notify($1, 'test.dedupe', 'Once', 'k-dedupe') as id
       union all
       select btg.notify($1, 'test.dedupe', 'Once', 'k-dedupe') as id`,
      [ada.id],
    );
    expect(ids[0].id).toBe(ids[1].id);
    const [{ count }] = await sql<{ count: string }>(
      "select count(*)::text as count from public.notifications where profile_id = $1",
      [ada.id],
    );
    expect(count).toBe("1");
  });
});
