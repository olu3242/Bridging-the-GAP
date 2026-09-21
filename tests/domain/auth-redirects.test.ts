import { afterEach, describe, expect, it } from "vitest";
import { absoluteUrl, resolveSiteOrigin, safeRedirectPath } from "@/lib/url";
import { authErrorCopy, exchangeErrorCode, isAuthErrorCode, oauthErrorCode } from "@/domain/identity/auth-errors";
import { BRAND_ROUTES } from "@/components/brand/brand";

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

const SAVED = {
  site: process.env.NEXT_PUBLIC_SITE_URL,
  vercel: process.env.VERCEL_URL,
  env: process.env.VERCEL_ENV,
};

afterEach(() => {
  for (const [key, value] of [
    ["NEXT_PUBLIC_SITE_URL", SAVED.site],
    ["VERCEL_URL", SAVED.vercel],
    ["VERCEL_ENV", SAVED.env],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/**
 * Every Supabase redirect — email confirmation, recovery, OAuth callback — is
 * built from an absolute origin, so an origin resolved from the wrong source
 * breaks auth in exactly the environment that is hardest to debug.
 */
describe("auth redirect origin", () => {
  it("prefers the configured site URL in production", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://btg.ai";
    process.env.VERCEL_ENV = "production";
    expect(resolveSiteOrigin(headers({ "x-forwarded-host": "internal.vercel.app" }))).toBe("https://btg.ai");
  });

  it("uses the request's own host on a preview, where the site URL is not this host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://btg.ai";
    process.env.VERCEL_ENV = "preview";
    expect(
      resolveSiteOrigin(headers({ "x-forwarded-host": "btg-git-branch.vercel.app", "x-forwarded-proto": "https" })),
    ).toBe("https://btg-git-branch.vercel.app");
  });

  it("falls back to the forwarded host, then to localhost", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_ENV;
    expect(resolveSiteOrigin(headers({ host: "127.0.0.1:3100" }))).toBe("http://127.0.0.1:3100");
    expect(resolveSiteOrigin(undefined)).toBe("http://localhost:3000");
  });

  it("reads only the first entry of a forwarded chain", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_ENV;
    expect(
      resolveSiteOrigin(headers({ "x-forwarded-host": "btg.ai, proxy.internal", "x-forwarded-proto": "https, http" })),
    ).toBe("https://btg.ai");
  });

  it("builds the callback URL on the resolved origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://btg.ai/";
    process.env.VERCEL_ENV = "production";
    expect(absoluteUrl(BRAND_ROUTES.authCallback)).toBe("https://btg.ai/auth/callback");
  });
});

describe("post-auth destination guard", () => {
  it("keeps same-origin paths", () => {
    expect(safeRedirectPath("/dashboard", "/x")).toBe("/dashboard");
    expect(safeRedirectPath("/projects/abc?tab=1", "/x")).toBe("/projects/abc?tab=1");
  });

  it("refuses anything that could bounce a session off-site", () => {
    for (const hostile of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "dashboard",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(safeRedirectPath(hostile, "/sign-in"), String(hostile)).toBe("/sign-in");
    }
  });
});

describe("auth failure codes", () => {
  it("reads a cancelled Google consent screen as cancelled, not failed", () => {
    expect(oauthErrorCode("access_denied", "The user denied the request")).toBe("oauth_cancelled");
    expect(oauthErrorCode("server_error", null)).toBe("oauth_failed");
    expect(oauthErrorCode("validation_failed", "Unsupported provider is not enabled")).toBe(
      "provider_disabled",
    );
  });

  it("tells an expired link apart from a used one", () => {
    expect(exchangeErrorCode("Email link is invalid or has expired")).toBe("expired_link");
    expect(exchangeErrorCode("invalid request: both auth code and code verifier should be non-empty")).toBe(
      "invalid_code",
    );
  });

  it("resolves every code to branded copy, and unknown input to nothing", () => {
    for (const code of [
      "missing_code",
      "invalid_code",
      "expired_link",
      "oauth_cancelled",
      "oauth_failed",
      "provider_disabled",
      "session_expired",
      "recovery_required",
      "config_missing",
    ]) {
      expect(isAuthErrorCode(code)).toBe(true);
      const copy = authErrorCopy(code);
      expect(copy?.title.length, code).toBeGreaterThan(0);
      expect(copy?.message.length, code).toBeGreaterThan(0);
    }
    expect(authErrorCopy("provider_secret_leak")).toBeNull();
    expect(authErrorCopy(undefined)).toBeNull();
  });
});
