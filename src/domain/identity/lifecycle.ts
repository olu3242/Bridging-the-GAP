import { createStateMachine } from "../shared/state-machine";

/**
 * These maps are the TypeScript mirror of btg.state_transitions. A database
 * test asserts both sides stay identical, so drift fails CI rather than
 * surfacing as a runtime surprise.
 */
export const MEMBERSHIP_STATUSES = ["invited", "active", "suspended", "revoked"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const membershipMachine = createStateMachine<MembershipStatus>("membership", {
  invited: ["active", "revoked"],
  active: ["suspended", "revoked"],
  suspended: ["active", "revoked"],
  revoked: [],
});

export const GRANT_STATUSES = ["active", "suspended", "revoked"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const personaGrantMachine = createStateMachine<GrantStatus>("persona_grant", {
  active: ["suspended", "revoked"],
  suspended: ["active", "revoked"],
  revoked: [],
});

export const ORGANIZATION_STATUSES = ["pending", "active", "suspended", "archived"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const organizationMachine = createStateMachine<OrganizationStatus>("organization", {
  pending: ["active", "archived"],
  active: ["suspended", "archived"],
  suspended: ["active", "archived"],
  archived: [],
});

export const ONBOARDING_STATES = [
  "not_started",
  "profile",
  "persona",
  "goals",
  "consent",
  "completed",
] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

/** Linear and forward-only: a learner cannot skip or rewind a step. */
export const onboardingMachine = createStateMachine<OnboardingState>("onboarding", {
  not_started: ["profile"],
  profile: ["persona"],
  persona: ["goals"],
  goals: ["consent"],
  consent: ["completed"],
  completed: [],
});

export const DB_STATE_MACHINES = [
  membershipMachine,
  personaGrantMachine,
  organizationMachine,
  onboardingMachine,
] as const;
