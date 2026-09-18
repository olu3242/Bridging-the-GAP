/**
 * E1 — Identity & Access Engine: personas and the capabilities they carry.
 *
 * A route existing never implies access. Every server action and every piece of
 * navigation resolves through `can()` here, and the database enforces the same
 * boundary independently through RLS.
 */
export const PERSONAS = [
  "learner",
  "mentor",
  "reviewer",
  "institution",
  "employer",
  "sponsor",
  "operator",
] as const;

export type Persona = (typeof PERSONAS)[number];

/** Personas granted platform-wide, independent of any organization. */
export const PLATFORM_PERSONAS = ["learner", "operator", "reviewer", "mentor"] as const satisfies readonly Persona[];

/** Personas that only exist inside an organization. */
export const ORG_PERSONAS = [
  "mentor",
  "reviewer",
  "institution",
  "employer",
  "sponsor",
  "operator",
] as const satisfies readonly Persona[];

/** Personas that govern an organization's members and settings. */
export const ORG_ADMIN_PERSONAS = ["institution", "employer", "sponsor", "operator"] as const satisfies readonly Persona[];

export const PERSONA_LABELS: Record<Persona, string> = {
  learner: "Learner",
  mentor: "Mentor",
  reviewer: "Reviewer",
  institution: "Institution",
  employer: "Employer",
  sponsor: "Sponsor",
  operator: "Operator",
};

/**
 * Capabilities are the authorization vocabulary. Waves add to this list; they
 * never bypass it.
 */
export const CAPABILITIES = [
  "profile.read_own",
  "profile.update_own",
  "onboarding.complete_own",
  "consent.record_own",
  "notification.read_own",
  "file.upload_own",
  "organization.create",
  "organization.read",
  "organization.manage",
  "membership.invite",
  "membership.manage",
  "learner.dashboard.view",
  "project.manage_own",
  "evidence.submit_own",
  "credential.read_own",
  "review.decide",
  "mentor.workspace.view",
  "reviewer.queue.view",
  "institution.portal.view",
  "employer.portal.view",
  "sponsor.portal.view",
  "operator.console.view",
  "audit.read_own",
  "audit.read_org",
  "audit.read_all",
  "platform.govern",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const SELF_SERVICE: readonly Capability[] = [
  "profile.read_own",
  "profile.update_own",
  "onboarding.complete_own",
  "consent.record_own",
  "notification.read_own",
  "file.upload_own",
  "audit.read_own",
];

export const PERSONA_CAPABILITIES: Record<Persona, readonly Capability[]> = {
  learner: [
    ...SELF_SERVICE,
    "learner.dashboard.view",
    "organization.create",
    "project.manage_own",
    "evidence.submit_own",
    "credential.read_own",
  ],
  mentor: [...SELF_SERVICE, "mentor.workspace.view", "organization.read"],
  reviewer: [...SELF_SERVICE, "reviewer.queue.view", "review.decide", "organization.read"],
  institution: [
    ...SELF_SERVICE,
    "institution.portal.view",
    "organization.read",
    "organization.manage",
    "membership.invite",
    "membership.manage",
    "audit.read_org",
  ],
  employer: [
    ...SELF_SERVICE,
    "employer.portal.view",
    "organization.read",
    "organization.manage",
    "membership.invite",
    "membership.manage",
    "audit.read_org",
  ],
  sponsor: [
    ...SELF_SERVICE,
    "sponsor.portal.view",
    "organization.read",
    "organization.manage",
    "membership.invite",
    "membership.manage",
    "audit.read_org",
  ],
  operator: [...CAPABILITIES],
};

export function capabilitiesFor(personas: readonly Persona[]): Set<Capability> {
  const set = new Set<Capability>();
  for (const persona of personas) {
    for (const capability of PERSONA_CAPABILITIES[persona] ?? []) set.add(capability);
  }
  return set;
}

export function isPlatformPersona(persona: Persona): boolean {
  return (PLATFORM_PERSONAS as readonly Persona[]).includes(persona);
}

export function isOrgPersona(persona: Persona): boolean {
  return (ORG_PERSONAS as readonly Persona[]).includes(persona);
}

export function isOrgAdminPersona(persona: Persona): boolean {
  return (ORG_ADMIN_PERSONAS as readonly Persona[]).includes(persona);
}
