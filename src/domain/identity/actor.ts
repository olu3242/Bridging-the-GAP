import { DomainError } from "../shared/errors";
import {
  type Capability,
  type Persona,
  PERSONA_CAPABILITIES,
  capabilitiesFor,
  isOrgAdminPersona,
} from "./persona";

export interface ActorMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  persona: Persona;
}

/**
 * The authenticated actor, assembled once per request from the database and
 * passed down into every domain service. Never assembled from client input.
 */
export interface Actor {
  profileId: string;
  email: string | null;
  displayName: string;
  primaryPersona: Persona;
  onboardingState: string;
  /** Platform-level personas (persona_grants). */
  platformPersonas: readonly Persona[];
  /** Active org-scoped personas (memberships). */
  memberships: readonly ActorMembership[];
}

export function personasOf(actor: Actor): Persona[] {
  return Array.from(new Set<Persona>([...actor.platformPersonas, ...actor.memberships.map((m) => m.persona)]));
}

export function isOperator(actor: Actor): boolean {
  return actor.platformPersonas.includes("operator");
}

export function organizationPersonas(actor: Actor, organizationId: string): Persona[] {
  return actor.memberships.filter((m) => m.organizationId === organizationId).map((m) => m.persona);
}

export interface AuthorizationScope {
  /** Required when the capability is organization-scoped. */
  organizationId?: string;
}

/**
 * Capability check. Organization-scoped capabilities are only granted by a
 * membership *in that organization*; a persona held elsewhere never leaks
 * across tenants.
 */
export function can(actor: Actor, capability: Capability, scope: AuthorizationScope = {}): boolean {
  if (isOperator(actor)) return true;

  if (scope.organizationId) {
    const personas = organizationPersonas(actor, scope.organizationId);
    if (personas.some((p) => PERSONA_CAPABILITIES[p]?.includes(capability))) return true;
    // Self-service capabilities stay valid inside an org context.
    return capabilitiesFor(actor.platformPersonas).has(capability) && capability.endsWith("_own");
  }

  return capabilitiesFor(personasOf(actor)).has(capability);
}

export function assertCan(actor: Actor, capability: Capability, scope: AuthorizationScope = {}): void {
  if (!can(actor, capability, scope)) {
    throw DomainError.forbidden(`This action requires the "${capability}" capability.`, {
      capability,
      organizationId: scope.organizationId,
    });
  }
}

export function governedOrganizationIds(actor: Actor): string[] {
  return Array.from(
    new Set(actor.memberships.filter((m) => isOrgAdminPersona(m.persona)).map((m) => m.organizationId)),
  );
}

/** Capabilities the actor holds anywhere — used to build persona-aware navigation. */
export function effectiveCapabilities(actor: Actor): Set<Capability> {
  return capabilitiesFor(personasOf(actor));
}
