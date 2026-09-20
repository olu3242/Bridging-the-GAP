import { describe, expect, it } from "vitest";
import {
  JOURNEY_GATES,
  PRODUCT_HOME,
  isPathAllowed,
  resolveDestination,
  resolveEntryGate,
} from "@/domain/identity/journey";

const anonymous = { authenticated: false, onboardingState: "not_started" } as const;
const onboarding = { authenticated: true, onboardingState: "goals" } as const;
const preBaseline = { authenticated: true, onboardingState: "completed" } as const;
const prePathway = {
  authenticated: true,
  onboardingState: "completed",
  baselineCompleted: true,
} as const;
const ready = {
  authenticated: true,
  onboardingState: "completed",
  baselineCompleted: true,
  pathwayGenerated: true,
} as const;

describe("journey resolution", () => {
  it("sends an anonymous visitor to sign in", () => {
    expect(resolveDestination(anonymous)).toBe("/sign-in");
  });

  it("sends a part-onboarded learner back to onboarding, not the dashboard", () => {
    expect(resolveDestination(onboarding)).toBe("/onboarding");
    expect(resolveDestination({ authenticated: true, onboardingState: "not_started" })).toBe(
      "/onboarding",
    );
  });

  it("sends an onboarded learner to the baseline before the product", () => {
    expect(resolveDestination(preBaseline)).toBe("/baseline");
  });

  it("sends a measured learner to pathway generation before the product", () => {
    expect(resolveDestination(prePathway)).toBe("/pathway");
  });

  it("sends a learner with an active pathway to the product", () => {
    expect(resolveDestination(ready)).toBe(PRODUCT_HOME);
    expect(resolveEntryGate(ready)).toBeNull();
  });

  it("only ever routes to an implemented stage", () => {
    // Every gate is implemented today. This asserts the invariant rather than
    // the current roster, so it keeps guarding when a future stage is added
    // with implemented: false.
    const allowed = new Set([
      PRODUCT_HOME,
      ...JOURNEY_GATES.filter((gate) => gate.implemented).map((gate) => gate.route),
    ]);
    const unimplemented = JOURNEY_GATES.filter((gate) => !gate.implemented).map((gate) => gate.route);

    for (const state of [anonymous, onboarding, preBaseline, prePathway, ready]) {
      const destination = resolveDestination(state);
      expect(allowed).toContain(destination);
      expect(unimplemented).not.toContain(destination);
    }
  });

  it("gates in canonical lifecycle order", () => {
    const implemented = JOURNEY_GATES.filter((g) => g.implemented).map((g) => g.stage);
    expect(implemented).toEqual(["identity", "onboarding", "baseline", "pathway"]);
  });

  it("confines a learner to the outstanding gate", () => {
    expect(isPathAllowed(onboarding, "/onboarding")).toBe(true);
    expect(isPathAllowed(onboarding, "/dashboard")).toBe(false);
    expect(isPathAllowed(onboarding, "/baseline")).toBe(false);

    expect(isPathAllowed(preBaseline, "/baseline")).toBe(true);
    expect(isPathAllowed(preBaseline, "/baseline/results")).toBe(true);
    expect(isPathAllowed(preBaseline, "/dashboard")).toBe(false);

    expect(isPathAllowed(prePathway, "/pathway")).toBe(true);
    expect(isPathAllowed(prePathway, "/dashboard")).toBe(false);
  });

  it("lets a measured learner roam the product", () => {
    expect(isPathAllowed(ready, "/dashboard")).toBe(true);
    expect(isPathAllowed(ready, "/organizations")).toBe(true);
    expect(isPathAllowed(ready, "/baseline")).toBe(true);
    expect(isPathAllowed(ready, "/pathway/some-step")).toBe(true);
  });
});

describe("the learner journey is not imposed on other personas", () => {
  const reviewer = {
    authenticated: true,
    onboardingState: "completed",
    primaryPersona: "reviewer",
  } as const;

  it("does not send a reviewer through a learner baseline", () => {
    expect(resolveDestination(reviewer)).toBe(PRODUCT_HOME);
    expect(resolveEntryGate(reviewer)).toBeNull();
  });

  it("lets a reviewer reach the review queue", () => {
    expect(isPathAllowed(reviewer, "/review")).toBe(true);
    expect(isPathAllowed(reviewer, "/review/abc")).toBe(true);
  });

  it("still requires every persona to finish onboarding", () => {
    expect(
      resolveDestination({
        authenticated: true,
        onboardingState: "persona",
        primaryPersona: "reviewer",
      }),
    ).toBe("/onboarding");
  });

  it("treats an unstated persona as a learner", () => {
    expect(resolveDestination({ authenticated: true, onboardingState: "completed" })).toBe("/baseline");
  });
});
