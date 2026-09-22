import { z } from "zod";

/**
 * Environment contract. Missing configuration fails loudly at the boundary
 * rather than producing a half-working authenticated experience.
 *
 * Two things this deliberately tolerates, because both are how the deployed
 * configuration actually goes wrong rather than hypotheticals:
 *
 *  1. A variable that is *defined but blank*. A hosting dashboard will happily
 *     store an empty value, and `process.env.X ?? fallback` does not catch it
 *     because `""` is neither null nor undefined. A blank value is not a
 *     configured value, so it is read as absent.
 *  2. A site URL given as a bare host (`example.vercel.app`). `resolveSiteOrigin`
 *     in ./url.ts already normalises that shape; this schema rejecting it meant
 *     the two disagreed about the same string.
 *
 * What it must never do is accept the value under a different name. Next.js
 * inlines `NEXT_PUBLIC_*` into the browser bundle at build time, so a variable
 * named without that prefix can never reach the client — falling back to one
 * would fix the server and leave the browser broken, which is harder to find
 * than the failure it replaced.
 */

/** Reads a variable, treating blank or whitespace-only as unset. */
function read(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Gives a bare host a scheme, so `example.com` and `https://example.com` agree. */
function withScheme(value: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

const DEFAULT_SITE_URL = "http://localhost:3000";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("NEXT_PUBLIC_SUPABASE_URL must be a URL."),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY does not look like a key."),
  NEXT_PUBLIC_SITE_URL: z.url("NEXT_PUBLIC_SITE_URL must be a URL.").default(DEFAULT_SITE_URL),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/** The variables the application reads, in the order the diagnostic reports them. */
export const REQUIRED_PUBLIC_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/**
 * Names a previous configuration used. They are only ever *reported*, never
 * read: see the note above on why reading them would be worse than failing.
 */
const LEGACY_ALIASES: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "NEXT_SUPABASE_URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "NEXT_SUPABASE_ANON_KEY",
  NEXT_PUBLIC_SITE_URL: "NEXT_SITE_URL",
};

/**
 * Says what is wrong with each variable in terms of what to do about it, so the
 * failure names the fix instead of only the symptom. Distinguishes "not set"
 * from "set but blank" — the two look identical in a dashboard and have the
 * same effect here, but only one of them means someone already tried.
 */
function describeMisconfiguration(): string[] {
  const problems: string[] = [];

  for (const name of REQUIRED_PUBLIC_VARS) {
    const raw = process.env[name];
    const legacy = LEGACY_ALIASES[name];
    const legacyIsSet = typeof process.env[legacy] === "string" && process.env[legacy]!.trim() !== "";

    if (raw === undefined) {
      problems.push(
        legacyIsSet
          ? `${name} is not set, but ${legacy} is — rename it: only NEXT_PUBLIC_* reaches the browser.`
          : `${name} is not set.`,
      );
    } else if (raw.trim() === "") {
      problems.push(`${name} is set but empty — give it a value, or remove it.`);
    }
  }

  const siteUrl = read("NEXT_PUBLIC_SITE_URL");
  if (siteUrl !== undefined) {
    try {
      new URL(withScheme(siteUrl));
    } catch {
      problems.push(`NEXT_PUBLIC_SITE_URL is not a usable URL.`);
    }
  }

  return problems;
}

let cached: PublicEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cached) return cached;

  const siteUrl = read("NEXT_PUBLIC_SITE_URL");
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: read("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    // Blank is treated as unset so the default applies, and a bare host is
    // given a scheme rather than rejected.
    NEXT_PUBLIC_SITE_URL: siteUrl === undefined ? DEFAULT_SITE_URL : withScheme(siteUrl),
  });

  if (!parsed.success) {
    // Prefer the per-variable diagnostic; fall back to the schema's own
    // messages if a failure shape ever escapes it.
    const problems = describeMisconfiguration();
    const detail = problems.length > 0 ? problems : parsed.error.issues.map((i) => i.message);
    throw new Error(
      `Supabase is not configured. ${detail.join(" ")} ` +
        `Set these on the deployment and redeploy — NEXT_PUBLIC_* values are ` +
        `baked into the build, so changing them does not take effect until a new build runs.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/**
 * True when the app has enough configuration to talk to Supabase. A variable
 * that is present but blank counts as absent, exactly as `publicEnv` treats it.
 */
export function isSupabaseConfigured(): boolean {
  return REQUIRED_PUBLIC_VARS.every((name) => read(name) !== undefined);
}

/** Test seam: the module caches the parsed environment for the process. */
export function resetPublicEnvCache(): void {
  cached = null;
}
