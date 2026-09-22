/**
 * E16 — canonical audit actions. Every high-value W01 action writes one.
 * Format is `<domain>.<object>.<verb>` and is enforced by a check constraint.
 */
export const AUDIT_ACTIONS = {
  profileUpdated: "identity.profile.updated",
  onboardingStarted: "identity.onboarding.started",
  onboardingStepCompleted: "identity.onboarding.step_completed",
  onboardingCompleted: "identity.onboarding.completed",
  consentRecorded: "identity.consent.recorded",
  organizationCreated: "identity.organization.created",
  organizationStatusChanged: "identity.organization.status_changed",
  membershipInvited: "identity.membership.invited",
  membershipStatusChanged: "identity.membership.status_changed",
  notificationRead: "notification.notification.read",
  signedIn: "identity.session.signed_in",
  signedUp: "identity.session.signed_up",
  signedOut: "identity.session.signed_out",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_ACTION_PATTERN = /^[a-z0-9_]+\.[a-z0-9_.]+$/;

export type AuditSeverity = "info" | "notice" | "warning" | "critical";

export interface AuditEventInput {
  action: AuditAction;
  objectType: string;
  objectId?: string | null;
  organizationId?: string | null;
  actorPersona?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  severity?: AuditSeverity;
  correlationId?: string | null;
  workflow?: string | null;
  policyVersion?: string | null;
  metadata?: Record<string, unknown>;
}
