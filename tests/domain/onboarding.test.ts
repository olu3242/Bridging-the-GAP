import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  consentStepSchema,
  currentStep,
  goalsStepSchema,
  personaStepSchema,
  profileStepSchema,
  progressPercent,
  stepIndex,
} from "@/domain/identity/onboarding";

describe("onboarding step schemas", () => {
  it("normalises a profile step", () => {
    const parsed = profileStepSchema.parse({
      displayName: "  Ada Okoro ",
      fullName: "Ada Okoro",
      countryCode: "ng",
      timezone: "Africa/Lagos",
    });
    expect(parsed.displayName).toBe("Ada Okoro");
    expect(parsed.countryCode).toBe("NG");
  });

  it("rejects a one-character display name", () => {
    expect(profileStepSchema.safeParse({ displayName: "A", timezone: "UTC" }).success).toBe(false);
  });

  it("rejects a persona that is not selectable at onboarding", () => {
    expect(personaStepSchema.safeParse({ primaryPersona: "operator" }).success).toBe(false);
    expect(personaStepSchema.safeParse({ primaryPersona: "learner" }).success).toBe(true);
  });

  it("bounds weekly hours and focus areas", () => {
    const base = { primaryGoal: "Land an internship", weeklyHours: 5 };
    expect(goalsStepSchema.safeParse({ ...base, weeklyHours: 0 }).success).toBe(false);
    expect(goalsStepSchema.safeParse({ ...base, weeklyHours: 61 }).success).toBe(false);
    expect(goalsStepSchema.safeParse({ ...base, weeklyHours: "12" }).success).toBe(true);
    expect(
      goalsStepSchema.safeParse({ ...base, focusAreas: Array.from({ length: 9 }, (_, i) => `area-${i}`) })
        .success,
    ).toBe(false);
  });

  it("requires the three mandatory consents", () => {
    const granted = { terms: true, privacy: true, aiProcessing: true };
    expect(consentStepSchema.safeParse(granted).success).toBe(true);
    expect(consentStepSchema.safeParse({ ...granted, aiProcessing: false }).success).toBe(false);
    expect(consentStepSchema.safeParse({ ...granted, terms: false }).success).toBe(false);
  });

  it("treats optional consents as genuinely optional", () => {
    const parsed = consentStepSchema.parse({ terms: true, privacy: true, aiProcessing: true });
    expect(parsed.marketing).toBe(false);
    expect(parsed.evidenceSharing).toBe(false);
  });
});

describe("onboarding progress", () => {
  it("reports progress from the persisted state", () => {
    expect(progressPercent("not_started")).toBe(0);
    expect(progressPercent("goals")).toBe(50);
    expect(progressPercent("completed")).toBe(100);
  });

  it("starts a fresh learner on the first step", () => {
    expect(currentStep("not_started")?.state).toBe("profile");
    expect(currentStep("completed")).toBeNull();
    expect(stepIndex("consent")).toBe(ONBOARDING_STEPS.length - 1);
  });
});
