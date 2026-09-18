import { z } from "zod";
import { attemptMachine, type AttemptStatus } from "@/domain/identity/lifecycle";

export { attemptMachine };
export type { AttemptStatus };

/**
 * E3 — the adaptive probe, documented because it is deliberately simple and
 * explainable rather than model-driven.
 *
 * Each competency gets two questions: an opener at level 2, then level 4 if
 * that was right and level 1 if it was not. The estimate is the highest level
 * answered correctly, or 0 if none were.
 *
 * Two questions cannot resolve every level — levels 3 and 5 are not reachable
 * from this probe — so the baseline is reported with a confidence figure and
 * later evidence (W06) supersedes it.
 */
export const PROBE_OPENING_LEVEL = 2;
export const PROBE_STEP_UP_LEVEL = 4;
export const PROBE_STEP_DOWN_LEVEL = 1;
export const PROBES_PER_COMPETENCY = 2;

export const REACHABLE_BASELINE_LEVELS = [0, 1, 2, 4] as const;

/** The level the next probe should target, given the opener's outcome. */
export function nextProbeLevel(firstAnswerCorrect: boolean | null): number {
  if (firstAnswerCorrect === null) return PROBE_OPENING_LEVEL;
  return firstAnswerCorrect ? PROBE_STEP_UP_LEVEL : PROBE_STEP_DOWN_LEVEL;
}

/** The estimate the scoring command will reach for a set of graded answers. */
export function estimateLevel(answers: readonly { level: number; correct: boolean }[]): number {
  const passed = answers.filter((a) => a.correct).map((a) => a.level);
  return passed.length === 0 ? 0 : Math.max(...passed);
}

/** Confidence grows with the number of questions behind an estimate. */
export function estimateConfidence(questionCount: number): number {
  return Math.min(0.35 + 0.15 * questionCount, 0.95);
}

export const answerQuestionSchema = z.object({
  attemptId: z.uuid("That attempt is not recognised."),
  questionId: z.uuid("That question is not recognised."),
  selectedOptionIds: z
    .array(z.string().trim().min(1).max(8))
    .min(1, "Choose an answer to continue.")
    .max(8),
  elapsedMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
});

export const attemptIdSchema = z.object({ attemptId: z.uuid() });

export type AnswerQuestionInput = z.input<typeof answerQuestionSchema>;

export function isAttemptOpen(status: AttemptStatus): boolean {
  return status === "in_progress";
}

export function attemptProgress(answered: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((answered / expected) * 100)));
}
