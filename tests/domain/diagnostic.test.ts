import { describe, expect, it } from "vitest";
import {
  PROBES_PER_COMPETENCY,
  PROBE_OPENING_LEVEL,
  PROBE_STEP_DOWN_LEVEL,
  PROBE_STEP_UP_LEVEL,
  REACHABLE_BASELINE_LEVELS,
  answerQuestionSchema,
  attemptMachine,
  attemptProgress,
  estimateConfidence,
  estimateLevel,
  nextProbeLevel,
} from "@/domain/diagnostic/attempt";
import {
  GAP_SEVERITY_COPY,
  LEVEL_LABELS,
  compareByPriority,
  gapSeverity,
  isLevel,
  progressToTarget,
} from "@/domain/competency/levels";

describe("adaptive probe", () => {
  it("opens at the developing level", () => {
    expect(nextProbeLevel(null)).toBe(PROBE_OPENING_LEVEL);
  });

  it("steps up after a correct answer and down after a wrong one", () => {
    expect(nextProbeLevel(true)).toBe(PROBE_STEP_UP_LEVEL);
    expect(nextProbeLevel(false)).toBe(PROBE_STEP_DOWN_LEVEL);
  });

  it("estimates the highest level answered correctly", () => {
    expect(estimateLevel([{ level: 2, correct: true }, { level: 4, correct: true }])).toBe(4);
    expect(estimateLevel([{ level: 2, correct: true }, { level: 4, correct: false }])).toBe(2);
    expect(estimateLevel([{ level: 2, correct: false }, { level: 1, correct: true }])).toBe(1);
    expect(estimateLevel([{ level: 2, correct: false }, { level: 1, correct: false }])).toBe(0);
  });

  it("only claims the levels a two-question probe can actually reach", () => {
    const reachable = new Set<number>();
    for (const first of [true, false]) {
      for (const second of [true, false]) {
        reachable.add(
          estimateLevel([
            { level: PROBE_OPENING_LEVEL, correct: first },
            { level: nextProbeLevel(first), correct: second },
          ]),
        );
      }
    }
    expect([...reachable].sort()).toEqual([...REACHABLE_BASELINE_LEVELS].sort());
  });

  it("raises confidence with each question behind the estimate", () => {
    expect(estimateConfidence(1)).toBeCloseTo(0.5);
    expect(estimateConfidence(PROBES_PER_COMPETENCY)).toBeCloseTo(0.65);
    expect(estimateConfidence(100)).toBe(0.95);
  });

  it("reports progress against the expected question count", () => {
    expect(attemptProgress(0, 16)).toBe(0);
    expect(attemptProgress(8, 16)).toBe(50);
    expect(attemptProgress(16, 16)).toBe(100);
    expect(attemptProgress(3, 0)).toBe(0);
  });
});

describe("attempt lifecycle", () => {
  it("can only reach scored through submission", () => {
    expect(attemptMachine.can("in_progress", "scored")).toBe(false);
    expect(attemptMachine.can("in_progress", "submitted")).toBe(true);
    expect(attemptMachine.can("submitted", "scored")).toBe(true);
  });

  it("treats scored and abandoned as terminal", () => {
    expect(attemptMachine.next("scored")).toHaveLength(0);
    expect(attemptMachine.next("abandoned")).toHaveLength(0);
  });
});

describe("answer validation", () => {
  it("requires a selection", () => {
    const result = answerQuestionSchema.safeParse({
      attemptId: "11111111-1111-4111-8111-111111111111",
      questionId: "22222222-2222-4222-8222-222222222222",
      selectedOptionIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a single option", () => {
    const result = answerQuestionSchema.safeParse({
      attemptId: "11111111-1111-4111-8111-111111111111",
      questionId: "22222222-2222-4222-8222-222222222222",
      selectedOptionIds: ["c"],
    });
    expect(result.success).toBe(true);
  });
});

describe("competency levels and gaps", () => {
  it("labels every level in range", () => {
    for (let level = 0; level <= 5; level += 1) {
      expect(isLevel(level)).toBe(true);
      expect(LEVEL_LABELS[level as 0]).toBeTruthy();
    }
    expect(isLevel(6)).toBe(false);
    expect(isLevel(2.5)).toBe(false);
  });

  it("grades gap severity by distance to target", () => {
    expect(gapSeverity(3, 3)).toBe("met");
    expect(gapSeverity(4, 3)).toBe("met");
    expect(gapSeverity(2, 3)).toBe("close");
    expect(gapSeverity(1, 3)).toBe("developing");
    expect(gapSeverity(0, 4)).toBe("priority");
    expect(Object.keys(GAP_SEVERITY_COPY).sort()).toEqual(
      ["close", "developing", "met", "priority"].sort(),
    );
  });

  it("orders by widest gap, then least confidence", () => {
    const ordered = [
      { gap: 1, confidence: 0.9 },
      { gap: 3, confidence: 0.8 },
      { gap: 3, confidence: 0.5 },
    ].sort(compareByPriority);
    expect(ordered).toEqual([
      { gap: 3, confidence: 0.5 },
      { gap: 3, confidence: 0.8 },
      { gap: 1, confidence: 0.9 },
    ]);
  });

  it("reports progress toward target", () => {
    expect(progressToTarget(0, 3)).toBe(0);
    expect(progressToTarget(2, 4)).toBe(50);
    expect(progressToTarget(4, 3)).toBe(100);
  });
});
