import { readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_ROUTE_PREFIXES,
  AUTH_ROUTE_PREFIXES,
  SESSION_ONLY_PREFIXES,
  isAuthRoute,
  isJourneyGated,
  requiresSession,
} from "@/domain/identity/routes";

const dir = (path: string) => new URL(`../../${path}`, import.meta.url);

function routeSegments(group: string): string[] {
  return readdirSync(dir(`src/app/${group}`), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("("))
    .map((entry) => `/${entry.name}`)
    .sort();
}

/**
 * The regression this file exists for: the session proxy used to carry its own
 * prefix list, and every wave that shipped a new `(app)` surface left it
 * behind. A route missing from the list served an anonymous visitor a bare
 * redirect with no `?next=`, so they lost where they were going.
 */
describe("route protection contract", () => {
  it("protects every route in the (app) group", () => {
    const onDisk = routeSegments("(app)");
    const missing = onDisk.filter((segment) => !requiresSession(segment));
    expect(missing, "these (app) routes are not protected by the session proxy").toEqual([]);
  });

  it("claims no prefix that is not a real route", () => {
    for (const prefix of [...APP_ROUTE_PREFIXES, ...SESSION_ONLY_PREFIXES]) {
      const inApp = existsSync(dir(`src/app/(app)${prefix}`));
      const inAuth = existsSync(dir(`src/app/(auth)${prefix}`));
      expect(inApp || inAuth, `${prefix} is protected but has no page`).toBe(true);
    }
  });

  it("backs every auth prefix with a real page", () => {
    for (const prefix of AUTH_ROUTE_PREFIXES) {
      expect(existsSync(dir(`src/app/(auth)${prefix}/page.tsx`)), `${prefix} has no page`).toBe(true);
      expect(isAuthRoute(prefix)).toBe(true);
    }
  });

  it("requires a session for session-only routes without journey-gating them", () => {
    for (const prefix of SESSION_ONLY_PREFIXES) {
      expect(requiresSession(prefix), `${prefix} must require a session`).toBe(true);
      // Gating these would strand a recovery session, or redirect the
      // access-denied state away before it can explain itself.
      expect(isJourneyGated(prefix), `${prefix} must not be journey-gated`).toBe(false);
    }
  });

  it("matches nested paths but never a same-prefixed sibling", () => {
    expect(requiresSession("/projects/abc")).toBe(true);
    expect(requiresSession("/console/workflows/xyz")).toBe(true);
    expect(requiresSession("/projects-public")).toBe(false);
    expect(requiresSession("/")).toBe(false);
    expect(requiresSession("/sign-in")).toBe(false);
  });

  it("never treats an auth route as needing a session", () => {
    for (const prefix of AUTH_ROUTE_PREFIXES) expect(requiresSession(prefix)).toBe(false);
  });
});
