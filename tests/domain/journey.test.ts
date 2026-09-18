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
const ready = {
  authenticated: true,
  onboardingState: "completed",
  baselineCompleted: true,
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

  it("sends a measured learner to the product", () => {
    expect(resolveDestination(ready)).toBe(PRODUCT_HOME);
    expect(resolveEntryGate(ready)).toBeNull();
  });

  it("never routes to a stage whose wave has not shipped", () => {
    const unimplemented = JOURNEY_GATES.filter((gate) => !gate.implemented).map((gate) => gate.route);
    expect(unimplemented.length).toBeGreaterThan(0);
    for (const state of [anonymous, onboarding, preBaseline, ready]) {
      expect(unimplemented).not.toContain(resolveDestination(state));
    }
  });

  it("gates in canonical lifecycle order", () => {
    const implemented = JOURNEY_GATES.filter((g) => g.implemented).map((g) => g.stage);
    expect(implemented).toEqual(["identity", "onboarding", "baseline"]);
  });

  it("confines a learner to the outstanding gate", () => {
    expect(isPathAllowed(onboarding, "/onboarding")).toBe(true);
    expect(isPathAllowed(onboarding, "/dashboard")).toBe(false);
    expect(isPathAllowed(onboarding, "/baseline")).toBe(false);

    expect(isPathAllowed(preBaseline, "/baseline")).toBe(true);
    expect(isPathAllowed(preBaseline, "/baseline/results")).toBe(true);
    expect(isPathAllowed(preBaseline, "/dashboard")).toBe(false);
  });

  it("lets a measured learner roam the product", () => {
    expect(isPathAllowed(ready, "/dashboard")).toBe(true);
    expect(isPathAllowed(ready, "/organizations")).toBe(true);
    expect(isPathAllowed(ready, "/baseline")).toBe(true);
  });
});
