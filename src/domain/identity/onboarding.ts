import { z } from "zod";
import { type OnboardingState, onboardingMachine } from "./lifecycle";
import { PERSONAS, type Persona } from "./persona";

/** Bump when the consent copy changes; historical consents keep their version. */
export const CONSENT_POLICY_VERSION = "2026-09-18";

export interface OnboardingStep {
  state: Exclude<OnboardingState, "not_started" | "completed">;
  order: number;
  title: string;
  description: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    state: "profile",
    order: 1,
    title: "Who you are",
    description: "Your name and where you are learning from.",
  },
  {
    state: "persona",
    order: 2,
    title: "How you'll use BTG",
    description: "Learn, mentor, review, or represent an organization.",
  },
  {
    state: "goals",
    order: 3,
    title: "What you're working towards",
    description: "The outcome your pathway will be built around.",
  },
  {
    state: "consent",
    order: 4,
    title: "Your data and AI",
    description: "What you agree to before we personalize anything.",
  },
];

export function stepIndex(state: OnboardingState): number {
  if (state === "not_started") return 0;
  if (state === "completed") return ONBOARDING_STEPS.length;
  return ONBOARDING_STEPS.findIndex((s) => s.state === state);
}

export function progressPercent(state: OnboardingState): number {
  return Math.round((stepIndex(state) / ONBOARDING_STEPS.length) * 100);
}

/** The step a learner should be shown given their persisted state. */
export function currentStep(state: OnboardingState): OnboardingStep | null {
  if (state === "completed") return null;
  if (state === "not_started") return ONBOARDING_STEPS[0];
  return ONBOARDING_STEPS.find((s) => s.state === state) ?? null;
}

export function nextState(state: OnboardingState): OnboardingState {
  const [next] = onboardingMachine.next(state);
  return next ?? state;
}

const trimmed = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Use at least ${min} characters.`)
    .max(max, `Use at most ${max} characters.`);

export const profileStepSchema = z.object({
  displayName: trimmed(2, 80),
  fullName: trimmed(2, 160).optional().or(z.literal("")),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code.")
    .transform((v) => v.toUpperCase())
    .optional()
    .or(z.literal("")),
  timezone: trimmed(3, 64).default("UTC"),
});

/** Intent chosen at onboarding. Organization personas still require a membership. */
export const SELECTABLE_PERSONAS = ["learner", "mentor", "reviewer", "institution", "employer", "sponsor"] as const;

export const personaStepSchema = z.object({
  primaryPersona: z.enum(SELECTABLE_PERSONAS),
  headline: trimmed(2, 200).optional().or(z.literal("")),
});

export const goalsStepSchema = z.object({
  primaryGoal: trimmed(3, 160),
  focusAreas: z.array(trimmed(2, 48)).max(8, "Pick up to 8 focus areas.").default([]),
  experienceLevel: z.enum(["beginner", "developing", "intermediate", "advanced"]).default("beginner"),
  weeklyHours: z.coerce.number().int().min(1, "At least 1 hour.").max(60, "At most 60 hours."),
  targetOutcome: trimmed(2, 400).optional().or(z.literal("")),
  educationStage: trimmed(2, 80).optional().or(z.literal("")),
});

export const consentStepSchema = z.object({
  terms: z.literal(true, { message: "You must accept the terms to continue." }),
  privacy: z.literal(true, { message: "You must accept the privacy notice to continue." }),
  aiProcessing: z.literal(true, { message: "AI personalization consent is required to generate a pathway." }),
  evidenceSharing: z.boolean().default(false),
  marketing: z.boolean().default(false),
});

export type ProfileStepInput = z.input<typeof profileStepSchema>;
export type PersonaStepInput = z.input<typeof personaStepSchema>;
export type GoalsStepInput = z.input<typeof goalsStepSchema>;
export type ConsentStepInput = z.input<typeof consentStepSchema>;

export const PERSONA_INTENT_COPY: Record<(typeof SELECTABLE_PERSONAS)[number], string> = {
  learner: "Build skills, prove them, and get matched to opportunity.",
  mentor: "Guide learners and review the work they build.",
  reviewer: "Assess submitted evidence against rubrics.",
  institution: "Run programs and cohorts for your learners.",
  employer: "Post challenges and find proven candidates.",
  sponsor: "Fund programs and track the outcomes they produce.",
};

export function isSelectablePersona(value: string): value is (typeof SELECTABLE_PERSONAS)[number] {
  return (SELECTABLE_PERSONAS as readonly string[]).includes(value);
}

export const ALL_PERSONAS: readonly Persona[] = PERSONAS;
