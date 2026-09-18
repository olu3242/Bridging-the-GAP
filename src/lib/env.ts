import { z } from "zod";

/**
 * Environment contract. Missing configuration fails loudly at the boundary
 * rather than producing a half-working authenticated experience.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("NEXT_PUBLIC_SUPABASE_URL must be a URL."),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing."),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

let cached: PublicEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cached) return cached;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  });
  if (!parsed.success) {
    throw new Error(
      `Supabase is not configured. ${parsed.error.issues.map((i) => i.message).join(" ")}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** True when the app has enough configuration to talk to Supabase. */
export function isSupabaseConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}
