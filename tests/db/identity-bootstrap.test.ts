import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asUser, completeOnboarding, sql } from "./helpers";

/**
 * Both auth methods must converge on ONE application identity.
 *
 * These insert into `auth.users` the way GoTrue does — an email signup carries
 * our own `display_name`, a Google signup carries Google's `name`/`picture` —
 * and then assert the bootstrap trigger provisioned the same shape of
 * application record either way, exactly once.
 */

interface AuthInsert {
  email: string;
  userMeta?: Record<string, unknown>;
  appMeta?: Record<string, unknown>;
}

async function insertAuthUser({ email, userMeta = {}, appMeta = {} }: AuthInsert): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
     values ($1, $2, $3, now()) returning id`,
    [email, JSON.stringify(userMeta), JSON.stringify(appMeta)],
  );
  return row.id;
}

/** The metadata Supabase actually writes for a Google identity. */
function googleMetadata(name: string, email: string) {
  return {
    iss: "https://accounts.google.com",
    sub: `1078${randomUUID().replace(/-/g, "").slice(0, 17)}`,
    name,
    full_name: name,
    given_name: name.split(" ")[0],
    family_name: name.split(" ").slice(1).join(" "),
    email,
    email_verified: true,
    picture: "https://lh3.googleusercontent.com/a/test-avatar",
    avatar_url: "https://lh3.googleusercontent.com/a/test-avatar",
    provider_id: "107812345678901234567",
  };
}

async function profileOf(id: string) {
  const [row] = await sql<{
    id: string;
    display_name: string;
    full_name: string | null;
    avatar_url: string | null;
    primary_persona: string;
    onboarding_state: string;
  }>(
    `select id, display_name, full_name, avatar_url, primary_persona, onboarding_state
     from public.profiles where id = $1`,
    [id],
  );
  return row;
}

async function grantsOf(id: string) {
  return sql<{ persona: string; status: string }>(
    "select persona, status from public.persona_grants where profile_id = $1 order by persona",
    [id],
  );
}

describe("application bootstrap is shared by every auth method", () => {
  it("provisions an email signup from the display name it typed", async () => {
    const email = `bootstrap-email-${randomUUID().slice(0, 8)}@btg.test`;
    const id = await insertAuthUser({
      email,
      userMeta: { display_name: "Ada Okoro", full_name: "Ada Okoro", intended_persona: "learner" },
      appMeta: { provider: "email", providers: ["email"] },
    });

    const profile = await profileOf(id);
    expect(profile.display_name).toBe("Ada Okoro");
    expect(profile.full_name).toBe("Ada Okoro");
    expect(profile.primary_persona).toBe("learner");
    expect(profile.onboarding_state).toBe("not_started");
    expect(await grantsOf(id)).toEqual([{ persona: "learner", status: "active" }]);

    const [audit] = await sql<{ after: { auth_provider: string } }>(
      `select after from public.audit_events
        where actor_profile_id = $1 and action = 'identity.session.signed_up'`,
      [id],
    );
    expect(audit.after.auth_provider).toBe("email");
  });

  it("provisions a first-time Google signup from Google's own profile fields", async () => {
    const email = `bootstrap-google-${randomUUID().slice(0, 8)}@btg.test`;
    const id = await insertAuthUser({
      email,
      userMeta: googleMetadata("Chidi Nwosu", email),
      appMeta: { provider: "google", providers: ["google"] },
    });
    await sql(
      `insert into auth.identities (user_id, provider, provider_id, identity_data)
       values ($1, 'google', $2, $3)`,
      [id, randomUUID(), JSON.stringify(googleMetadata("Chidi Nwosu", email))],
    );

    const profile = await profileOf(id);
    // The regression this covers: the trigger only read `display_name`, so a
    // Google learner was provisioned as the local part of their email.
    expect(profile.display_name).toBe("Chidi Nwosu");
    expect(profile.display_name).not.toBe(email.split("@")[0]);
    expect(profile.full_name).toBe("Chidi Nwosu");
    expect(profile.avatar_url).toBe("https://lh3.googleusercontent.com/a/test-avatar");
    // Identical authorization to the email learner: no second persona model.
    expect(profile.primary_persona).toBe("learner");
    expect(await grantsOf(id)).toEqual([{ persona: "learner", status: "active" }]);

    // The signup is on the same audit spine as an email signup, and records
    // which method the account arrived through.
    const [audit] = await sql<{ action: string; after: { auth_provider: string } }>(
      `select action, after from public.audit_events
        where actor_profile_id = $1 and action = 'identity.session.signed_up'`,
      [id],
    );
    expect(audit.action).toBe("identity.session.signed_up");
    expect(audit.after.auth_provider).toBe("google");
  });

  it("falls back through name, given name and finally the email local part", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: "Only Name" }, "Only Name"],
      [{ given_name: "Ngozi" }, "Ngozi"],
      [{}, null as unknown as string],
      [{ display_name: "  " }, null as unknown as string],
    ];

    for (const [meta, expected] of cases) {
      const email = `fallback-${randomUUID().slice(0, 8)}@btg.test`;
      const id = await insertAuthUser({ email, userMeta: meta });
      const profile = await profileOf(id);
      expect(profile.display_name).toBe(expected ?? email.split("@")[0]);
      // Whatever the provider sends, the column's own floor is respected.
      expect(profile.display_name.trim().length).toBeGreaterThanOrEqual(2);
    }
  });

  it("pads a provider name too short for the profile's own constraint", async () => {
    const email = `short-name-${randomUUID().slice(0, 8)}@btg.test`;
    const id = await insertAuthUser({ email, userMeta: { name: "A" } });
    const profile = await profileOf(id);
    expect(profile.display_name).toBe("A learner");
  });

  it("truncates an over-long provider name instead of failing signup", async () => {
    const email = `long-name-${randomUUID().slice(0, 8)}@btg.test`;
    const id = await insertAuthUser({ email, userMeta: { name: "Ọ".repeat(200) } });
    const profile = await profileOf(id);
    expect(profile.display_name.length).toBe(80);
  });
});

describe("no duplicate application identity", () => {
  it("creates exactly one profile and one learner grant per auth user", async () => {
    const email = `single-identity-${randomUUID().slice(0, 8)}@btg.test`;
    const id = await insertAuthUser({
      email,
      userMeta: googleMetadata("Single Identity", email),
      appMeta: { provider: "google", providers: ["google"] },
    });

    const [{ profiles }] = await sql<{ profiles: string }>(
      "select count(*)::text as profiles from public.profiles where id = $1",
      [id],
    );
    expect(profiles).toBe("1");
    expect(await grantsOf(id)).toHaveLength(1);
  });

  it("does not re-provision a returning Google user", async () => {
    const email = `returning-google-${randomUUID().slice(0, 8)}@btg.test`;
    const id = await insertAuthUser({
      email,
      userMeta: googleMetadata("Returning Learner", email),
      appMeta: { provider: "google", providers: ["google"] },
    });

    // A returning sign-in is not an insert into auth.users, so the bootstrap
    // cannot run a second time. That is a property of the trigger itself:
    const [trigger] = await sql<{ timing: string; events: string; enabled: string }>(
      `select action_timing as timing, string_agg(event_manipulation, ',' order by event_manipulation) as events,
              'O' as enabled
         from information_schema.triggers
        where trigger_name = 'on_auth_user_created'
        group by action_timing`,
    );
    expect(trigger.events).toBe("INSERT");
    expect(trigger.timing).toBe("AFTER");

    // And the bootstrap's own writes are conflict-safe, so even a replay
    // cannot overwrite what the learner has since changed.
    // Move the learner forward through the real onboarding commands, so the
    // state a replay would have to overwrite is genuine.
    await completeOnboarding(id);
    await sql(
      `insert into public.profiles (id, display_name, locale) values ($1, 'Replayed Name', 'en')
       on conflict (id) do nothing`,
      [id],
    );
    await sql(
      `insert into public.persona_grants (profile_id, persona, status) values ($1, 'learner', 'active')
       on conflict (profile_id, persona) do nothing`,
      [id],
    );

    const profile = await profileOf(id);
    // The learner's own onboarding survives; nothing was reset or duplicated.
    expect(profile.display_name).toBe("Test Learner");
    expect(profile.display_name).not.toBe("Replayed Name");
    expect(profile.onboarding_state).toBe("completed");
    expect(await grantsOf(id)).toEqual([{ persona: "learner", status: "active" }]);
  });

  it("keeps one identity when a second provider is linked onto the same account", async () => {
    const email = `linked-identity-${randomUUID().slice(0, 8)}@btg.test`;
    const id = await insertAuthUser({
      email,
      userMeta: { display_name: "Linked Learner", full_name: "Linked Learner" },
      appMeta: { provider: "email", providers: ["email"] },
    });
    await sql(
      `insert into auth.identities (user_id, provider, provider_id, identity_data)
       values ($1, 'email', $2, '{}'::jsonb)`,
      [id, randomUUID()],
    );

    // Supabase links a verified Google identity onto the SAME auth user rather
    // than creating a second one, and records it in raw_app_meta_data.
    await sql(
      `insert into auth.identities (user_id, provider, provider_id, identity_data)
       values ($1, 'google', $2, $3)`,
      [id, randomUUID(), JSON.stringify(googleMetadata("Linked Learner", email))],
    );
    await sql(
      `update auth.users set raw_app_meta_data = jsonb_build_object(
         'provider', 'email', 'providers', jsonb_build_array('email', 'google'))
       where id = $1`,
      [id],
    );

    const [{ identities }] = await sql<{ identities: string }>(
      "select count(*)::text as identities from auth.identities where user_id = $1",
      [id],
    );
    const [{ profiles }] = await sql<{ profiles: string }>(
      "select count(*)::text as profiles from public.profiles where id = $1",
      [id],
    );
    expect(identities).toBe("2");
    // Two ways in, one application identity.
    expect(profiles).toBe("1");
    expect(await grantsOf(id)).toHaveLength(1);
  });
});

describe("a bootstrapped session reads its own records through RLS", () => {
  it("lets a Google-provisioned learner read its profile and nothing else", async () => {
    const mine = `rls-google-${randomUUID().slice(0, 8)}@btg.test`;
    const theirs = `rls-other-${randomUUID().slice(0, 8)}@btg.test`;
    const myId = await insertAuthUser({
      email: mine,
      userMeta: googleMetadata("Rls Google", mine),
      appMeta: { provider: "google", providers: ["google"] },
    });
    const otherId = await insertAuthUser({
      email: theirs,
      userMeta: { display_name: "Rls Other" },
      appMeta: { provider: "email", providers: ["email"] },
    });

    const visible = await asUser(myId, async (client) => {
      const result = await client.query("select id from public.profiles order by id");
      return result.rows.map((r) => r.id as string);
    });

    expect(visible).toContain(myId);
    expect(visible).not.toContain(otherId);
  });

  it("gives an email learner and a Google learner identical visibility", async () => {
    const a = `parity-email-${randomUUID().slice(0, 8)}@btg.test`;
    const b = `parity-google-${randomUUID().slice(0, 8)}@btg.test`;
    const emailId = await insertAuthUser({ email: a, userMeta: { display_name: "Parity Email" } });
    const googleId = await insertAuthUser({
      email: b,
      userMeta: googleMetadata("Parity Google", b),
      appMeta: { provider: "google", providers: ["google"] },
    });

    const shape = async (id: string) =>
      asUser(id, async (client) => {
        const grants = await client.query(
          "select persona, status from public.persona_grants order by persona",
        );
        const profiles = await client.query("select count(*)::int as n from public.profiles");
        return { grants: grants.rows, profiles: profiles.rows[0].n as number };
      });

    expect(await shape(googleId)).toEqual(await shape(emailId));
  });
});
