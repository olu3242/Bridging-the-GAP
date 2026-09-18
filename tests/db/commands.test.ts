import { describe, expect, it } from "vitest";
import {
  asUser,
  completeOnboarding,
  createOrganizationAs,
  createUser,
  expectRejection,
  sql,
} from "./helpers";

describe("signup bootstrap", () => {
  it("provisions a profile and a learner grant for every new auth user", async () => {
    const user = await createUser("fresh");
    const [profile] = await sql<{ display_name: string; onboarding_state: string }>(
      "select display_name, onboarding_state from public.profiles where id = $1",
      [user.id],
    );
    expect(profile.onboarding_state).toBe("not_started");
    expect(profile.display_name).toBe("fresh");

    const grants = await sql<{ persona: string }>(
      "select persona from public.persona_grants where profile_id = $1 and status = 'active'",
      [user.id],
    );
    expect(grants.map((g) => g.persona)).toEqual(["learner"]);
  });
});

describe("create_organization", () => {
  it("creates the organization and its founding governing membership atomically", async () => {
    const founder = await createUser("founder");
    const org = await createOrganizationAs(founder.id, "Atomic Uni");

    const [row] = await sql<{ status: string; created_by: string }>(
      "select status, created_by from public.organizations where id = $1",
      [org.id],
    );
    expect(row.status).toBe("pending");
    expect(row.created_by).toBe(founder.id);

    const [membership] = await sql<{ persona: string; status: string; activated_at: string | null }>(
      "select persona, status, activated_at from public.memberships where organization_id = $1",
      [org.id],
    );
    expect(membership).toMatchObject({ persona: "institution", status: "active" });
    expect(membership.activated_at).not.toBeNull();
  });

  it("writes an audit event for the creation", async () => {
    const founder = await createUser("founder");
    const org = await createOrganizationAs(founder.id, "Audited Uni");
    const [event] = await sql<{ action: string; actor_profile_id: string; severity: string }>(
      "select action, actor_profile_id, severity from public.audit_events where object_id = $1",
      [org.id],
    );
    expect(event).toMatchObject({
      action: "identity.organization.created",
      actor_profile_id: founder.id,
      severity: "notice",
    });
  });

  it("rejects a duplicate handle", async () => {
    const founder = await createUser("founder");
    const org = await createOrganizationAs(founder.id, "Unique Uni");
    const rejection = await expectRejection(
      asUser(founder.id, (client) =>
        client.query("select public.create_organization('Clone', $1, 'institution')", [org.slug]),
      ),
    );
    expect(rejection.code).toBe("23505");
  });

  it("refuses provisioning a platform organization", async () => {
    const founder = await createUser("founder");
    const rejection = await expectRejection(
      asUser(founder.id, (client) =>
        client.query("select public.create_organization('BTG', 'btg-platform', 'platform')"),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses an unauthenticated caller", async () => {
    const rejection = await expectRejection(
      sql("select public.create_organization('Ghost', 'ghost-org', 'employer')"),
    );
    expect(rejection.code).toBe("28000");
  });
});

describe("complete_onboarding_step", () => {
  it("walks a learner to completion and records the outcome", async () => {
    const learner = await createUser("walker");
    await completeOnboarding(learner.id, "Become a data analyst");

    const [profile] = await sql<{ onboarding_state: string; onboarding_completed_at: string | null }>(
      "select onboarding_state, onboarding_completed_at from public.profiles where id = $1",
      [learner.id],
    );
    expect(profile.onboarding_state).toBe("completed");
    expect(profile.onboarding_completed_at).not.toBeNull();

    const [learnerProfile] = await sql<{ primary_goal: string; weekly_hours: number }>(
      "select primary_goal, weekly_hours from public.learner_profiles where profile_id = $1",
      [learner.id],
    );
    expect(learnerProfile).toMatchObject({ primary_goal: "Become a data analyst", weekly_hours: 10 });

    const consents = await sql<{ consent_type: string; granted: boolean; policy_version: string }>(
      "select consent_type, granted, policy_version from public.consents where profile_id = $1 order by consent_type",
      [learner.id],
    );
    expect(consents).toHaveLength(5);
    expect(consents.every((c) => c.policy_version === "2026-09-18")).toBe(true);
    expect(consents.find((c) => c.consent_type === "ai_processing")?.granted).toBe(true);
    expect(consents.find((c) => c.consent_type === "marketing")?.granted).toBe(false);
  });

  it("notifies the learner exactly once on completion", async () => {
    const learner = await createUser("notified");
    await completeOnboarding(learner.id);
    const notifications = await sql<{ category: string }>(
      "select category from public.notifications where profile_id = $1",
      [learner.id],
    );
    expect(notifications).toEqual([{ category: "onboarding.completed" }]);
  });

  it("audits every step and marks completion as notable", async () => {
    const learner = await createUser("audited");
    await completeOnboarding(learner.id);
    const events = await sql<{ action: string; severity: string }>(
      "select action, severity from public.audit_events where actor_profile_id = $1 order by occurred_at",
      [learner.id],
    );
    expect(events).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({
      action: "identity.onboarding.completed",
      severity: "notice",
    });
  });

  it("refuses a step the learner is not standing on", async () => {
    const learner = await createUser("skipper");
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.complete_onboarding_step('consent', $1::jsonb)", [
          JSON.stringify({ terms: true, privacy: true, aiProcessing: true }),
        ]),
      ),
    );
    expect(rejection.message).toContain("invalid onboarding transition");
  });

  it("refuses completion without the required consents", async () => {
    const learner = await createUser("refuser");
    await asUser(learner.id, async (client) => {
      await client.query("select public.complete_onboarding_step('profile', $1::jsonb)", [
        JSON.stringify({ displayName: "Refuser" }),
      ]);
      await client.query("select public.complete_onboarding_step('persona', $1::jsonb)", [
        JSON.stringify({ primaryPersona: "learner" }),
      ]);
      await client.query("select public.complete_onboarding_step('goals', $1::jsonb)", [
        JSON.stringify({ primaryGoal: "Something", weeklyHours: 4 }),
      ]);
    });

    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.complete_onboarding_step('consent', $1::jsonb)", [
          JSON.stringify({ terms: true, privacy: true, aiProcessing: false }),
        ]),
      ),
    );
    expect(rejection.message).toContain("required consent missing");

    const [profile] = await sql<{ onboarding_state: string }>(
      "select onboarding_state from public.profiles where id = $1",
      [learner.id],
    );
    expect(profile.onboarding_state).toBe("consent");
  });

  it("rolls the whole step back when part of it fails", async () => {
    const learner = await createUser("atomic");
    await asUser(learner.id, async (client) => {
      await client.query("select public.complete_onboarding_step('profile', $1::jsonb)", [
        JSON.stringify({ displayName: "Atomic" }),
      ]);
      await client.query("select public.complete_onboarding_step('persona', $1::jsonb)", [
        JSON.stringify({ primaryPersona: "learner" }),
      ]);
    });

    // weeklyHours is outside the allowed range: the check constraint fires.
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.complete_onboarding_step('goals', $1::jsonb)", [
          JSON.stringify({ primaryGoal: "Out of range", weeklyHours: 900 }),
        ]),
      ),
    );
    expect(rejection.code).toBe("23514");

    const rows = await sql("select 1 from public.learner_profiles where profile_id = $1", [learner.id]);
    expect(rows).toHaveLength(0);
    const [profile] = await sql<{ onboarding_state: string }>(
      "select onboarding_state from public.profiles where id = $1",
      [learner.id],
    );
    expect(profile.onboarding_state).toBe("goals");
  });

  it("refuses an unauthenticated caller", async () => {
    const rejection = await expectRejection(
      sql("select public.complete_onboarding_step('profile', '{}'::jsonb)"),
    );
    expect(rejection.code).toBe("28000");
  });
});
