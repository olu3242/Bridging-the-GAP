import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSupabaseConfigured, publicEnv, resetPublicEnvCache } from "@/lib/env";

/**
 * The deployed configuration failed here, not in the auth code: `POST /sign-in`
 * showed no outgoing request at all, because `publicEnv()` threw before any
 * Supabase client was built.
 *
 * The decisive evidence was the message itself —
 *   "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing."
 * is the `min(20)` message, which can only fire when the value IS a string.
 * An unset variable produces a different message entirely. So the variables
 * existed on the deployment and were blank, which `?? fallback` cannot catch.
 */

const VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_SUPABASE_URL",
  "NEXT_SUPABASE_ANON_KEY",
  "NEXT_SITE_URL",
] as const;

const SAVED: Record<string, string | undefined> = {};
const VALID_URL = "https://project-ref.supabase.co";
const VALID_KEY = "a".repeat(40);

beforeEach(() => {
  for (const name of VARS) {
    SAVED[name] = process.env[name];
    delete process.env[name];
  }
  resetPublicEnvCache();
});

afterEach(() => {
  for (const name of VARS) {
    if (SAVED[name] === undefined) delete process.env[name];
    else process.env[name] = SAVED[name];
  }
  resetPublicEnvCache();
});

describe("a variable that is set but blank", () => {
  it("does not count as configured", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "   ";
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is reported as empty rather than as missing, so the cause is actionable", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL is set but empty/);
    resetPublicEnvCache();
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY is set but empty/);
  });

  it("no longer sinks an otherwise valid configuration via NEXT_PUBLIC_SITE_URL", () => {
    // The regression: a blank site URL took down sign-in even when Supabase
    // itself was configured correctly, because `""` skipped the default.
    process.env.NEXT_PUBLIC_SUPABASE_URL = VALID_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = VALID_KEY;
    process.env.NEXT_PUBLIC_SITE_URL = "";
    expect(() => publicEnv()).not.toThrow();
    expect(publicEnv().NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });
});

describe("site URL shapes", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = VALID_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = VALID_KEY;
  });

  it("accepts a bare host, matching how resolveSiteOrigin normalises one", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "bridging-the-gap.vercel.app";
    expect(publicEnv().NEXT_PUBLIC_SITE_URL).toBe("https://bridging-the-gap.vercel.app");
  });

  it("keeps an explicit scheme untouched", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3100";
    expect(publicEnv().NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3100");
  });

  it("trims surrounding whitespace, which a pasted value carries", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://btg.example  ";
    expect(publicEnv().NEXT_PUBLIC_SITE_URL).toBe("https://btg.example");
  });
});

describe("the legacy names", () => {
  it("are never read: only NEXT_PUBLIC_* reaches the browser bundle", () => {
    process.env.NEXT_SUPABASE_URL = VALID_URL;
    process.env.NEXT_SUPABASE_ANON_KEY = VALID_KEY;
    process.env.NEXT_SITE_URL = "https://btg.example";
    // Silently accepting these would fix the server and leave the client broken.
    expect(isSupabaseConfigured()).toBe(false);
    expect(() => publicEnv()).toThrow(/Supabase is not configured/);
  });

  it("are named in the failure when they are the only thing set", () => {
    process.env.NEXT_SUPABASE_URL = VALID_URL;
    process.env.NEXT_SUPABASE_ANON_KEY = VALID_KEY;
    expect(() => publicEnv()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL is not set, but NEXT_SUPABASE_URL is — rename it/,
    );
  });
});

describe("the failure message", () => {
  it("says that a redeploy is required, since NEXT_PUBLIC_* is baked into the build", () => {
    expect(() => publicEnv()).toThrow(/redeploy/i);
  });

  it("reports a genuinely unset variable as not set", () => {
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set\./);
  });
});

describe("a correct configuration", () => {
  it("parses, and reports as configured", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = VALID_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = VALID_KEY;
    process.env.NEXT_PUBLIC_SITE_URL = "https://btg.example";
    expect(isSupabaseConfigured()).toBe(true);
    expect(publicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: VALID_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: VALID_KEY,
      NEXT_PUBLIC_SITE_URL: "https://btg.example",
    });
  });
});
