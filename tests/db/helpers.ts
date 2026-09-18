import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export const DATABASE_URL =
  process.env.BTG_TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55432/btg_test";

export const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

/** Runs as the cluster owner: setup, seeding and introspection only. */
export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/**
 * Runs a block as a signed-in Supabase user: the `authenticated` role with
 * `auth.uid()` resolved from the request claim, which is exactly how PostgREST
 * executes a session. RLS therefore applies for real.
 */
export async function asUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
  options: { commit?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("set local role authenticated");
    const result = await fn(client);
    await client.query(options.commit === false ? "rollback" : "commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Runs a block with no session at all (the `anon` case). */
export async function asAnon<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } finally {
    client.release();
  }
}

export interface SeededUser {
  id: string;
  email: string;
}

/** Creates an auth user; the signup trigger provisions the profile + learner grant. */
export async function createUser(label: string, meta: Record<string, unknown> = {}): Promise<SeededUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@btg.test`;
  const [row] = await sql<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ display_name: label, ...meta })],
  );
  return { id: row.id, email };
}

export async function grantPersona(userId: string, persona: string): Promise<void> {
  await sql(
    `insert into public.persona_grants (profile_id, persona, status)
     values ($1, $2, 'active')
     on conflict (profile_id, persona) do update set status = 'active'`,
    [userId, persona],
  );
}

export async function createOrganizationAs(
  userId: string,
  name: string,
  type: "institution" | "employer" | "sponsor" = "institution",
): Promise<{ id: string; slug: string }> {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
  return asUser(userId, async (client) => {
    const result = await client.query(
      "select (public.create_organization($1, $2, $3::public.btg_org_type)).id as id",
      [name, slug, type],
    );
    return { id: result.rows[0].id as string, slug };
  });
}

/** Pushes a learner all the way through onboarding using the real command. */
export async function completeOnboarding(userId: string, goal = "Land a backend internship"): Promise<void> {
  await asUser(userId, async (client) => {
    await client.query("select public.complete_onboarding_step('profile', $1::jsonb, '2026-09-18')", [
      JSON.stringify({ displayName: "Test Learner", timezone: "UTC" }),
    ]);
    await client.query("select public.complete_onboarding_step('persona', $1::jsonb, '2026-09-18')", [
      JSON.stringify({ primaryPersona: "learner" }),
    ]);
    await client.query("select public.complete_onboarding_step('goals', $1::jsonb, '2026-09-18')", [
      JSON.stringify({ primaryGoal: goal, focusAreas: ["Software engineering"], weeklyHours: 10 }),
    ]);
    await client.query("select public.complete_onboarding_step('consent', $1::jsonb, '2026-09-18')", [
      JSON.stringify({ terms: true, privacy: true, aiProcessing: true }),
    ]);
  });
}

export async function expectRejection(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
    throw new Error("expected the database to reject this statement");
  } catch (error) {
    const pgError = error as { code?: string; message: string };
    if (pgError.message === "expected the database to reject this statement") throw error;
    return { code: pgError.code, message: pgError.message };
  }
}
