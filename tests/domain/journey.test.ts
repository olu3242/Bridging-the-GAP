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
const complete = { authenticated: true, onboardingState: "completed" } as const;

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

  it("sends a fully onboarded learner to the product", () => {
    expect(resolveDestination(complete)).toBe(PRODUCT_HOME);
  });

  it("never routes to a stage whose wave has not shipped", () => {
    const unimplemented = JOURNEY_GATES.filter((gate) => !gate.implemented).map((gate) => gate.route);
    expect(unimplemented.length).toBeGreaterThan(0);
    // A completed learner has satisfied no unimplemented gate, yet must not be
    // sent to one of those routes.
    expect(unimplemented).not.toContain(resolveDestination(complete));
  });

  it("confines a learner to the outstanding gate", () => {
    expect(isPathAllowed(onboarding, "/onboarding")).toBe(true);
    expect(isPathAllowed(onboarding, "/dashboard")).toBe(false);
    expect(isPathAllowed(onboarding, "/organizations")).toBe(false);
  });

  it("lets a completed learner roam the product", () => {
    expect(isPathAllowed(complete, "/dashboard")).toBe(true);
    expect(isPathAllowed(complete, "/organizations")).toBe(true);
    expect(resolveEntryGate(complete)).toBeNull();
  });
});
