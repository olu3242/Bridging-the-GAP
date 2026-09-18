"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/domain/identity/actor";
import { decideReviewSchema } from "@/domain/evidence/verification";
import { claimReview, decideReview } from "@/server/services/review-service";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, fieldErrorsFrom, toActionState } from "./action-result";

export async function claimReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const reviewId = formData.get("reviewId");
  if (typeof reviewId !== "string") return errorState("That review is not recognised.");

  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "review.decide");
    await claimReview(supabase, reviewId);
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/review");
  redirect(`/review/${reviewId}`);
}

/**
 * The reviewer's decision. Scores are parsed from `score:<criterionId>` fields;
 * the database re-checks that every required criterion is scored and none fall
 * below the pass mark, so a client cannot approve work the rubric failed.
 */
export async function decideReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "review.decide");

    const scores: Array<{ criterion_id: string; score: number }> = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("score:")) continue;
      const criterionId = key.slice("score:".length);
      const score = Number(value);
      if (Number.isFinite(score)) scores.push({ criterion_id: criterionId, score });
    }

    const parsed = decideReviewSchema.safeParse({
      reviewId: formData.get("reviewId"),
      decision: formData.get("decision"),
      rationale: formData.get("rationale"),
      scores,
    });
    if (!parsed.success) {
      return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
    }

    await decideReview(supabase, parsed.data);
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/review");
  redirect("/review?decided=1");
}
