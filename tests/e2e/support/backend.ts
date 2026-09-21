/**
 * Whether the configured Supabase project is actually reachable from here.
 *
 * Configuration alone is not enough to certify auth: an environment can carry a
 * valid project URL and still be unable to reach it (egress policy, offline
 * runner, paused project). Suites that need a live identity skip on *this*
 * rather than on the presence of env vars, so a skip always means "the backend
 * could not be reached" and never "someone forgot to set a variable".
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabaseConfigured = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);

let reachable: boolean | null = null;

export async function supabaseReachable(): Promise<boolean> {
  if (reachable !== null) return reachable;
  if (!supabaseConfigured) {
    reachable = false;
    return reachable;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: controller.signal,
    });
    clearTimeout(timer);
    reachable = response.ok;
  } catch {
    reachable = false;
  }
  return reachable;
}

/** The auth providers the project has enabled, when its settings can be read. */
export async function enabledProviders(): Promise<Record<string, boolean> | null> {
  if (!(await supabaseReachable())) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    const body = (await response.json()) as { external?: Record<string, boolean> };
    return body.external ?? null;
  } catch {
    return null;
  }
}

export const REACHABILITY_SKIP =
  "The configured Supabase project is not reachable from this environment, so a real identity cannot be created.";
