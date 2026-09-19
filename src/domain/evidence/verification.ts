import { z } from "zod";
import {
  credentialMachine,
  evidenceMachine,
  projectMachine,
  reviewMachine,
  type EvidenceStatus,
  type ProjectStatus,
  type ReviewStatus,
} from "@/domain/identity/lifecycle";

export { credentialMachine, evidenceMachine, projectMachine, reviewMachine };
export type { EvidenceStatus, ProjectStatus, ReviewStatus };

/** A criterion is met at 3 or better; approval needs every required one met. */
export const CRITERION_PASS_SCORE = 3;
export const CRITERION_MIN = 1;
export const CRITERION_MAX = 4;

export const PROJECT_STATUS_COPY: Record<ProjectStatus, string> = {
  assigned: "Not started",
  started: "In progress",
  submitted: "Submitted",
  under_review: "Under review",
  revision_required: "Revision needed",
  completed: "Verified",
  withdrawn: "Withdrawn",
};

export const REVIEW_DECISIONS = ["approved", "rejected", "revision_required"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export function isOpenForSubmission(status: ProjectStatus): boolean {
  return status === "assigned" || status === "started" || status === "revision_required";
}

/**
 * Mirrors the rule the database enforces: every required criterion must be
 * scored, and none may fall below the pass mark. Used to disable the approve
 * button before a reviewer wastes a round trip — the server decides.
 */
export function rubricSupportsApproval(
  criteria: readonly { id: string; is_required: boolean }[],
  scores: Readonly<Record<string, number | undefined>>,
): { ok: boolean; reason?: string } {
  const required = criteria.filter((c) => c.is_required);
  const unscored = required.filter((c) => scores[c.id] === undefined);
  if (unscored.length > 0) {
    return { ok: false, reason: `Score every required criterion (${unscored.length} left).` };
  }
  const failed = required.filter((c) => (scores[c.id] ?? 0) < CRITERION_PASS_SCORE);
  if (failed.length > 0) {
    return {
      ok: false,
      reason: `${failed.length} required criteria scored below ${CRITERION_PASS_SCORE}, so the rubric does not support approval.`,
    };
  }
  return { ok: true };
}

export const submitEvidenceSchema = z.object({
  projectId: z.uuid(),
  summary: z
    .string()
    .trim()
    .min(40, "Describe what you produced in at least 40 characters.")
    .max(4000),
  artifactUrl: z.string().trim().url("Enter a valid URL.").optional().or(z.literal("")),
  aiDeclared: z.boolean().default(false),
  aiNote: z.string().trim().max(1000).optional().or(z.literal("")),
}).refine((v) => !v.aiDeclared || Boolean(v.aiNote && v.aiNote.length > 0), {
  message: "Say how AI was used when you declare it.",
  path: ["aiNote"],
});

export const decideReviewSchema = z.object({
  reviewId: z.uuid(),
  decision: z.enum(REVIEW_DECISIONS),
  rationale: z.string().trim().min(10, "A decision needs a rationale of at least 10 characters.").max(2000),
  scores: z
    .array(
      z.object({
        criterion_id: z.uuid(),
        score: z.coerce.number().int().min(CRITERION_MIN).max(CRITERION_MAX),
      }),
    )
    .default([]),
});

export const assignProjectSchema = z.object({
  briefSlug: z.string().trim().min(3).max(80),
  stepId: z.uuid().optional(),
});
