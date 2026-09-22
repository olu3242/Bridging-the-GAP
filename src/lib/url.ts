/**
 * Environment-safe absolute-origin resolution.
 *
 * Every redirect Supabase hands back to us — email confirmation, password
 * recovery, OAuth callback — is generated from an absolute URL, so getting the
 * origin wrong breaks auth in exactly the environments that are hardest to
 * debug. The rules, in order:
 *
 *  1. `NEXT_PUBLIC_SITE_URL`, when set, is the deliberate production origin.
 *  2. On a Vercel preview the request's forwarded host is the only origin that
 *     actually resolves, so it wins over the (production) site URL.
 *  3. Otherwise the request's own forwarded host, then localhost.
 *
 * Next.js sits behind Vercel's proxy, where `request.nextUrl.origin` can be the
 * internal address rather than the one the browser used. Forwarded headers are
 * read first for that reason.
 */

const LOCAL_ORIGIN = "http://localhost:3000";

export interface OriginHeaders {
  get(name: string): string | null;
}

function normalize(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function fromForwardedHeaders(headers: OriginHeaders | undefined): string | null {
  if (!headers) return null;
  // `x-forwarded-host` can carry a comma-separated chain; the first entry is
  // the origin the browser actually asked for.
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  if (!host) return null;
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const scheme = proto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return normalize(`${scheme}://${host}`);
}

/** True on a Vercel preview or branch deployment, where the site URL is not this host. */
function isEphemeralDeployment(): boolean {
  const target = process.env.VERCEL_ENV;
  return target === "preview" || target === "development";
}

/**
 * The absolute origin to build auth redirects from. Pass the request headers
 * wherever they are available (route handlers, server actions) so previews and
 * custom domains resolve to themselves.
 */
export function resolveSiteOrigin(headers?: OriginHeaders): string {
  const forwarded = fromForwardedHeaders(headers);
  const configured = normalize(process.env.NEXT_PUBLIC_SITE_URL);
  const vercel = normalize(process.env.VERCEL_URL);

  if (isEphemeralDeployment()) return forwarded ?? vercel ?? configured ?? LOCAL_ORIGIN;
  return configured ?? forwarded ?? vercel ?? LOCAL_ORIGIN;
}

/**
 * Same-origin path guard. Anything that is not a plain in-app path is
 * discarded, so a crafted `?next=` can never bounce a session off-site.
 */
export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Reject anything carrying a scheme or a backslash-escaped host.
  if (/[\\]/.test(value) || /^\/+[a-z][a-z0-9+.-]*:/i.test(value)) return fallback;
  return value;
}

/** Builds an absolute auth URL on the resolved origin. */
export function absoluteUrl(path: string, headers?: OriginHeaders): string {
  const origin = resolveSiteOrigin(headers);
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
