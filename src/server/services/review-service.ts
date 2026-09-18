import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type { ReviewAssignmentRow, RubricCriterionRow } from "@/lib/db/types";
import type { ReviewDecision } from "@/domain/evidence/verification";

/** The open queue. RLS already limits this to reviewers and operators. */
export async function getReviewQueue(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("review_assignments")
    .select(
      "id, status, assigned_at, claimed_at, reviewer_profile_id, evidence(id, version, summary, artifact_url, ai_assistance_declared, ai_assistance_note, competency_id, rubric_id, submitted_at, competencies(name, slug))",
    )
    .in("status", ["pending", "in_review"])
    .order("assigned_at", { ascending: true })
    .limit(50);
  if (error) throw fromPostgresError(error, "We could not load the review queue.");
  return data ?? [];
}

export async function getReview(supabase: SupabaseClient, reviewId: string) {
  const { data, error } = await supabase
    .from("review_assignments")
    .select(
      "id, status, assigned_at, claimed_at, decided_at, rationale, reviewer_profile_id, evidence(id, version, summary, artifact_url, ai_assistance_declared, ai_assistance_note, rubric_id, submitted_at, project_id, competencies(name, slug))",
    )
    .eq("id", reviewId)
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load that review.");
  return data;
}

export async function getRubricCriteria(
  supabase: SupabaseClient,
  rubricId: string,
): Promise<RubricCriterionRow[]> {
  const { data, error } = await supabase
    .from("rubric_criteria")
    .select("*")
    .eq("rubric_id", rubricId)
    .order("sort_order", { ascending: true });
  if (error) throw fromPostgresError(error, "We could not load the rubric.");
  return (data ?? []) as RubricCriterionRow[];
}

export async function claimReview(
  supabase: SupabaseClient,
  reviewId: string,
): Promise<ReviewAssignmentRow> {
  const { data, error } = await supabase.rpc("claim_review", { p_review_id: reviewId });
  if (error) throw fromPostgresError(error, "We could not claim that review.");
  return data as ReviewAssignmentRow;
}

export async function decideReview(
  supabase: SupabaseClient,
  input: {
    reviewId: string;
    decision: ReviewDecision;
    rationale: string;
    scores: Array<{ criterion_id: string; score: number }>;
  },
): Promise<void> {
  const { error } = await supabase.rpc("decide_review", {
    p_review_id: input.reviewId,
    p_decision: input.decision,
    p_rationale: input.rationale,
    p_scores: input.scores,
  });
  if (error) throw fromPostgresError(error, "We could not record that decision.");
}
