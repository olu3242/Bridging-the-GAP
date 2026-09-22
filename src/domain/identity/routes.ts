/**
 * The route contract shared by the session proxy, the auth surface and the
 * route-coverage regression test.
 *
 * Previously the proxy carried its own hand-written prefix list, which drifted
 * behind the `(app)` route group every time a wave shipped a new surface: a
 * route that was missing from the list served an anonymous visitor a server
 * redirect with no `?next=`, losing where they were going. The list now lives
 * here, and `tests/domain/routes.test.ts` reads `src/app/(app)` off disk and
 * fails if a segment is missing — so adding a route cannot silently skip the
 * proxy again.
 */

/** Every top-level segment of the `(app)` route group. Requires an actor. */
export const APP_ROUTE_PREFIXES = [
  "/access",
  "/baseline",
  "/capabilities",
  "/challenges",
  "/console",
  "/contributions",
  "/dashboard",
  "/governance",
  "/intelligence",
  "/learn",
  "/mentorship",
  "/onboarding",
  "/opportunities",
  "/organizations",
  "/outcomes",
  "/pathway",
  "/portfolio",
  "/projects",
  "/review",
  "/tutor",
] as const;

/**
 * Routes that need a session but must never be journey-gated:
 *  - `/reset-password` — a recovery session has an unfinished journey, and
 *    bouncing it to `/onboarding` would make the reset link useless.
 *  - `/forbidden` — the access-denied state must be able to explain itself
 *    rather than being redirected away by the gate that sent the actor there.
 */
export const SESSION_ONLY_PREFIXES = ["/reset-password", "/forbidden"] as const;

/** Routes a signed-in visitor should never sit on. */
export const AUTH_ROUTE_PREFIXES = ["/sign-in", "/join", "/forgot-password"] as const;

/** Auth routes that are reachable without a session. */
export const PUBLIC_AUTH_ROUTES = [...AUTH_ROUTE_PREFIXES] as const;

export function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Requires an authenticated actor: the product surface plus session-only routes. */
export function requiresSession(pathname: string): boolean {
  return (
    matchesPrefix(pathname, APP_ROUTE_PREFIXES) || matchesPrefix(pathname, SESSION_ONLY_PREFIXES)
  );
}

/** Subject to journey gating (onboarding → baseline → pathway → product). */
export function isJourneyGated(pathname: string): boolean {
  return matchesPrefix(pathname, APP_ROUTE_PREFIXES);
}

export function isAuthRoute(pathname: string): boolean {
  return matchesPrefix(pathname, AUTH_ROUTE_PREFIXES);
}
