import "server-only";
import { redirect } from "next/navigation";
import { can, type AuthorizationScope } from "@/domain/identity/actor";
import type { Actor } from "@/domain/identity/actor";
import type { Capability } from "@/domain/identity/persona";

/**
 * Page-level capability gate.
 *
 * `assertCan` throws, which is right for a server action — the caller asked for
 * a mutation it may not make — but on a *page* it surfaced as the generic
 * "something went wrong" boundary, which tells the visitor nothing. A page gate
 * instead sends them to the branded access-denied state naming what is
 * missing.
 *
 * This is presentation only: the server action behind every control still calls
 * `assertCan`, and RLS re-checks the same authorization at the database. Nothing
 * here widens access.
 */
export function requireCapability(
  actor: Actor,
  capability: Capability,
  scope: AuthorizationScope = {},
): void {
  if (can(actor, capability, scope)) return;
  redirect(`/forbidden?need=${encodeURIComponent(capability)}`);
}
