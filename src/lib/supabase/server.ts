import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * The PKCE code verifier is read only by `exchangeCodeForSession`, which runs
 * in the callback route handler. Nothing in the browser needs it, so it is
 * written HTTP-only — the session cookies are left exactly as `@supabase/ssr`
 * sets them, because the browser client still has to read those.
 */
function harden(name: string, options: Record<string, unknown> = {}) {
  return name.includes("code-verifier") ? { ...options, httpOnly: true } : options;
}

/**
 * Request-scoped Supabase client. Every query made through it runs as the
 * signed-in user, so RLS — not application code — is the last line of defence.
 */
export async function createSupabaseServerClient() {
  const env = publicEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, harden(name, options));
          }
        } catch {
          // Called from a Server Component: the middleware refreshes the session.
        }
      },
    },
  });
}
