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

export const DIAGNOSTIC_STATUSES = ["draft", "published", "archived"] as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number];

export const diagnosticMachine = createStateMachine<DiagnosticStatus>("diagnostic", {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: [],
});

export const ATTEMPT_STATUSES = ["in_progress", "submitted", "scored", "abandoned"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * Scoring is reachable only through submission: a client cannot jump an
 * attempt straight to scored.
 */
export const attemptMachine = createStateMachine<AttemptStatus>("diagnostic_attempt", {
  in_progress: ["submitted", "abandoned"],
  submitted: ["scored", "abandoned"],
  scored: [],
  abandoned: [],
});

export const PATHWAY_STATUSES = ["draft", "active", "superseded", "archived"] as const;
export type PathwayStatus = (typeof PATHWAY_STATUSES)[number];

export const pathwayMachine = createStateMachine<PathwayStatus>("pathway", {
  draft: ["active", "archived"],
  active: ["superseded", "archived"],
  superseded: [],
  archived: [],
});

export const STEP_STATUSES = ["locked", "available", "in_progress", "completed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** completed → in_progress exists so a re-assessment can reopen a step. */
export const pathwayStepMachine = createStateMachine<StepStatus>("pathway_step", {
  locked: ["available"],
  available: ["in_progress", "skipped"],
  in_progress: ["completed", "available"],
  completed: ["in_progress"],
  skipped: [],
});

export const PROGRESS_STATUSES = ["locked", "available", "in_progress", "completed"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export const moduleProgressMachine = createStateMachine<ProgressStatus>("module_progress", {
  locked: ["available"],
  available: ["in_progress"],
  in_progress: ["completed", "available"],
  completed: [],
});

export const PROJECT_STATUSES = [
  "assigned", "started", "submitted", "under_review", "revision_required", "completed", "withdrawn",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projectMachine = createStateMachine<ProjectStatus>("project", {
  assigned: ["started", "withdrawn"],
  started: ["submitted", "withdrawn"],
  submitted: ["under_review"],
  under_review: ["revision_required", "completed"],
  revision_required: ["submitted", "withdrawn"],
  completed: [],
  withdrawn: [],
});

export const EVIDENCE_STATUSES = [
  "draft", "submitted", "under_review", "accepted", "rejected", "superseded",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const evidenceMachine = createStateMachine<EvidenceStatus>("evidence", {
  draft: ["submitted"],
  submitted: ["under_review", "superseded"],
  under_review: ["accepted", "rejected", "superseded"],
  accepted: [],
  rejected: ["superseded"],
  superseded: [],
});

export const REVIEW_STATUSES = [
  "pending", "in_review", "approved", "rejected", "revision_required",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const reviewMachine = createStateMachine<ReviewStatus>("review", {
  pending: ["in_review", "approved", "rejected", "revision_required"],
  in_review: ["approved", "rejected", "revision_required"],
  approved: [],
  rejected: [],
  revision_required: [],
});

export const CREDENTIAL_STATUSES = ["issued", "revoked", "expired"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const credentialMachine = createStateMachine<CredentialStatus>("credential", {
  issued: ["revoked", "expired"],
  revoked: [],
  expired: [],
});

export const DB_STATE_MACHINES = [
  membershipMachine,
  personaGrantMachine,
  organizationMachine,
  onboardingMachine,
  diagnosticMachine,
  attemptMachine,
  pathwayMachine,
  pathwayStepMachine,
  moduleProgressMachine,
  projectMachine,
  evidenceMachine,
  reviewMachine,
  credentialMachine,
] as const;
