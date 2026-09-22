import { z } from "zod";
import { pathwayStepMachine, type StepStatus } from "@/domain/identity/lifecycle";

export { pathwayStepMachine };
export type { StepStatus };

/**
 * E5 — the ordering rule, stated once so it can be explained and reproduced.
 *
 * Steps are sorted by topological depth in the prerequisite graph, then by the
 * widest gap, then catalogue order. Nothing is model-generated: the same
 * baseline always produces the same plan.
 */
export const PATHWAY_ORDERING = "prerequisite_depth,gap_desc,catalogue_order" as const;

export const STEP_STATUS_COPY: Record<StepStatus, string> = {
  locked: "Locked",
  available: "Ready",
  in_progress: "In progress",
  completed: "Done",
  skipped: "Skipped",
};

export function isActionableStep(status: StepStatus): boolean {
  return status === "available" || status === "in_progress";
}

/** The one step a learner should be pointed at next. */
export function nextStep<T extends { status: StepStatus; position: number }>(
  steps: readonly T[],
): T | null {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  return (
    ordered.find((s) => s.status === "in_progress") ??
    ordered.find((s) => s.status === "available") ??
    null
  );
}

export function pathwayProgress(steps: readonly { status: StepStatus }[]): number {
  if (steps.length === 0) return 100;
  const done = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  return Math.round((done / steps.length) * 100);
}

export const startStepSchema = z.object({ stepId: z.uuid("That step is not recognised.") });
export const completeActivitySchema = z.object({
  activityId: z.uuid("That activity is not recognised."),
  output: z.string().trim().max(4000, "Keep it under 4000 characters.").optional(),
});
