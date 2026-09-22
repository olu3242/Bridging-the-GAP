"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/identity/actor";
import { fromPostgresError } from "@/domain/shared/errors";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, successState, toActionState } from "./action-result";

export async function curriculumReviewAction(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "review.decide");
    const id = z.uuid().safeParse(form.get("attemptId"));
    if (!id.success) return errorState("That submission is not recognized.");
    const operation = form.get("operation");
    if (operation !== "claim" && operation !== "evaluate") return errorState("Unknown review action.");
    const scores: Record<string, number> = {};
    if (operation === "evaluate") {
      for (const [key, value] of form.entries()) {
        if (!key.startsWith("score:")) continue;
        if (typeof value !== "string" || !/^[0-4]$/.test(value)) return errorState("Score each criterion from 0 to 4.");
        scores[key.slice(6)] = Number(value);
      }
    }
    const feedback = z.string().trim().min(20).max(4000).safeParse(form.get("feedback"));
    if (operation === "evaluate" && !feedback.success) return errorState("Provide specific feedback between 20 and 4,000 characters.");
    const result = operation === "claim" ? await supabase.rpc("claim_curriculum_attempt", { p_attempt_id: id.data }) :
      await supabase.rpc("evaluate_curriculum_attempt", { p_attempt_id: id.data, p_scores: scores, p_feedback: feedback.data });
    if (result.error) throw fromPostgresError(result.error, "The review could not be recorded.");
    revalidatePath("/review");
    revalidatePath("/learn", "layout");
    return successState(operation === "claim" ? "Review claimed." : "Assessment decision recorded. This does not grant verified mastery.");
  } catch (error) { return toActionState(error); }
}
