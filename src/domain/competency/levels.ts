/**
 * E4 — the shared level ladder. Levels run 0..5, where 0 means "measured, not
 * yet demonstrated" rather than "unknown": an unmeasured competency has no
 * learner row at all.
 */
export const MIN_LEVEL = 0;
export const MAX_LEVEL = 5;

export type CompetencyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const LEVEL_LABELS: Record<CompetencyLevel, string> = {
  0: "Not yet shown",
  1: "Aware",
  2: "Developing",
  3: "Capable",
  4: "Proficient",
  5: "Leading",
};

export type GapSeverity = "met" | "close" | "developing" | "priority";

/**
 * How far a learner is from the level a competency treats as
 * opportunity-ready. Used to order a pathway and to explain a match.
 */
export function gapSeverity(level: number, targetLevel: number): GapSeverity {
  const gap = Math.max(targetLevel - level, 0);
  if (gap === 0) return "met";
  if (gap === 1) return "close";
  if (gap === 2) return "developing";
  return "priority";
}

export const GAP_SEVERITY_COPY: Record<GapSeverity, string> = {
  met: "At target",
  close: "One level to go",
  developing: "Two levels to go",
  priority: "Start here",
};

/** Ordering for a gap list: biggest gap first, then lowest confidence. */
export function compareByPriority(
  a: { gap: number; confidence: number },
  b: { gap: number; confidence: number },
): number {
  if (b.gap !== a.gap) return b.gap - a.gap;
  return a.confidence - b.confidence;
}

export function isLevel(value: number): value is CompetencyLevel {
  return Number.isInteger(value) && value >= MIN_LEVEL && value <= MAX_LEVEL;
}

/** Percentage of the way to target, for a progress bar. */
export function progressToTarget(level: number, targetLevel: number): number {
  if (targetLevel <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((level / targetLevel) * 100)));
}
