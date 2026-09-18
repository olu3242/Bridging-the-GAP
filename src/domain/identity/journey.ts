import type { OnboardingState } from "./lifecycle";

/**
 * The learner journey as an ordered set of gates. A gate blocks progress until
 * it is satisfied, and `resolveEntryGate` returns the one route a learner is
 * allowed to be on while it is outstanding.
 *
 * Stages owned by a wave that has not shipped carry `implemented: false` and
 * are skipped, so the resolver never sends anyone to a route that does not
 * exist. Shipping a wave flips one flag here instead of rewriting routing.
 */
export const JOURNEY_STAGES = [
  "identity",
  "onboarding",
  "baseline",
  "diagnosis",
  "pathway",
  "product",
] as const;

export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export interface JourneyState {
  authenticated: boolean;
  onboardingState: OnboardingState;
  /** W02 — set once a baseline diagnostic attempt has been scored. */
  baselineCompleted?: boolean;
  /** W03 — set once a pathway has been generated from the baseline. */
  pathwayGenerated?: boolean;
}

export interface JourneyGate {
  stage: JourneyStage;
  route: string;
  /** Flipped on by the wave that owns the stage. */
  implemented: boolean;
  satisfied: (state: JourneyState) => boolean;
}

export const JOURNEY_GATES: readonly JourneyGate[] = [
  {
    stage: "identity",
    route: "/sign-in",
    implemented: true,
    satisfied: (state) => state.authenticated,
  },
  {
    stage: "onboarding",
    route: "/onboarding",
    implemented: true,
    satisfied: (state) => state.onboardingState === "completed",
  },
  {
    stage: "baseline",
    route: "/baseline",
    implemented: false, // W02 — Diagnostic Engine
    satisfied: (state) => state.baselineCompleted === true,
  },
  {
    stage: "diagnosis",
    route: "/baseline/results",
    implemented: false, // W02 — gap diagnosis
    satisfied: (state) => state.baselineCompleted === true,
  },
  {
    stage: "pathway",
    route: "/pathway",
    implemented: false, // W03 — Pathway Engine
    satisfied: (state) => state.pathwayGenerated === true,
  },
];

/** Where a learner lands once every implemented gate is satisfied. */
export const PRODUCT_HOME = "/dashboard";

/**
 * The outstanding gate, or null when the learner is free to roam the product.
 * Unimplemented stages are skipped rather than treated as satisfied, so they
 * cannot silently become a permanent block.
 */
export function resolveEntryGate(state: JourneyState): JourneyGate | null {
  return JOURNEY_GATES.find((gate) => gate.implemented && !gate.satisfied(state)) ?? null;
}

/** The single destination a sign-in or a signed-in visit should resolve to. */
export function resolveDestination(state: JourneyState): string {
  return resolveEntryGate(state)?.route ?? PRODUCT_HOME;
}

/**
 * Whether a signed-in learner may stay on `pathname`. While a gate is
 * outstanding the only product route available is that gate's own route.
 */
export function isPathAllowed(state: JourneyState, pathname: string): boolean {
  const gate = resolveEntryGate(state);
  if (!gate) return true;
  return pathname === gate.route || pathname.startsWith(`${gate.route}/`);
}
