import { describe, expect, it } from "vitest";
import { OUTCOME_STAGES, type OutcomeStage } from "@/lib/db/types";
import {
  FUNNEL_STEPS,
  OUTCOME_LABELS,
  furthestStage,
  stageOrdinal,
} from "@/domain/outcomes/stages";

describe("outcome stages", () => {
  it("names every stage exactly once", () => {
    expect(Object.keys(OUTCOME_LABELS).sort()).toEqual([...OUTCOME_STAGES].sort());
    expect(new Set(OUTCOME_STAGES).size).toBe(OUTCOME_STAGES.length);
  });

  it("orders stages by the journey, not alphabetically", () => {
    expect(stageOrdinal("joined")).toBe(1);
    expect(stageOrdinal("baseline_measured")).toBeLessThan(stageOrdinal("pathway_generated"));
    expect(stageOrdinal("evidence_submitted")).toBeLessThan(stageOrdinal("skill_verified"));
    expect(stageOrdinal("skill_verified")).toBeLessThan(stageOrdinal("credential_issued"));
    expect(stageOrdinal("opportunity_applied")).toBeLessThan(stageOrdinal("opportunity_accepted"));
  });

  it("reports the furthest stage reached, never an assumed one", () => {
    expect(furthestStage([])).toBeNull();
    expect(furthestStage(["skill_verified", "joined", "evidence_submitted"])).toBe("skill_verified");
    // Out-of-order arrival does not change the answer: order comes from the stage, not the array.
    expect(furthestStage(["credential_issued", "onboarded"])).toBe("credential_issued");
  });

  it("builds the funnel only from declared stages", () => {
    for (const step of FUNNEL_STEPS) {
      expect(OUTCOME_STAGES).toContain(step.key as OutcomeStage);
      expect(step.label.length).toBeGreaterThan(0);
      expect(step.field.length).toBeGreaterThan(0);
    }
    // The funnel reads in journey order, so a dashboard cannot present a later
    // stage before an earlier one.
    const ordinals = FUNNEL_STEPS.map((s) => stageOrdinal(s.key as OutcomeStage));
    expect([...ordinals]).toEqual([...ordinals].sort((a, b) => a - b));
  });
});
