"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/domain/identity/actor";
import { answerQuestionSchema } from "@/domain/diagnostic/attempt";
import {
  answerQuestion,
  nextQuestion,
  startBaselineAttempt,
  submitAttempt,
} from "@/server/services/diagnostic-service";
import { requireContext } from "@/server/services/actor";
import { continueLearnerWork } from "@/server/services/workflow-service";
import { type ActionState, errorState, fieldErrorsFrom, toActionState } from "./action-result";

/**
 * UI → validation → actor → capability → domain command → persistence →
 * audit (inside the command) → next question or results.
 *
 * Answering does not tell the learner whether they were right: correctness is
 * graded server-side against a table they cannot read, and feedback would turn
 * the probe into a quiz they could walk.
 */
export async function answerBaselineQuestionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let finished = false;

  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "learner.dashboard.view");

    const parsed = answerQuestionSchema.safeParse({
      attemptId: formData.get("attemptId"),
      questionId: formData.get("questionId"),
      selectedOptionIds: formData.getAll("option").map(String).filter(Boolean),
      elapsedMs: formData.get("elapsedMs") || undefined,
    });
    if (!parsed.success) {
      return errorState("Choose an answer to continue.", fieldErrorsFrom(parsed.error));
    }

    await answerQuestion(supabase, parsed.data);

    // The walk decides whether anything remains; the client never does.
    const following = await nextQuestion(supabase, parsed.data.attemptId);
    if (!following) {
      await submitAttempt(supabase, parsed.data.attemptId);
      finished = true;
      /* The baseline is measured, so the pathway workflow has what it waits
         for. Declaring and draining here means the pathway exists by the time
         the learner reaches the results page, without the product depending on
         a deployed invoker. */
      await continueLearnerWork(supabase, {
        workflows: ["BTG_LEARNER_TO_OPPORTUNITY", "pathway_generation"],
        subjectType: "diagnostic_attempt",
        subjectId: parsed.data.attemptId,
      });
    }
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/baseline");
  if (finished) {
    revalidatePath("/baseline/results");
    revalidatePath("/dashboard");
    revalidatePath("/pathway");
    redirect("/baseline/results?scored=1");
  }
  redirect("/baseline");
}

/** Finishes an attempt whose probe is already complete — e.g. one interrupted
 *  after the last answer was recorded. */
export async function submitBaselineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const attemptId = formData.get("attemptId");
  if (typeof attemptId !== "string") {
    return errorState("That attempt is not recognised.", undefined, "VALIDATION");
  }

  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "learner.dashboard.view");
    await submitAttempt(supabase, attemptId);
    await continueLearnerWork(supabase, {
      workflows: ["BTG_LEARNER_TO_OPPORTUNITY", "pathway_generation"],
      subjectType: "diagnostic_attempt",
      subjectId: attemptId,
    });
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/baseline");
  revalidatePath("/baseline/results");
  revalidatePath("/dashboard");
  revalidatePath("/pathway");
  redirect("/baseline/results?scored=1");
}

export async function startBaselineAction(): Promise<void> {
  const { supabase, actor } = await requireContext();
  assertCan(actor, "learner.dashboard.view");
  const attempt = await startBaselineAttempt(supabase);
  await continueLearnerWork(supabase, {
    workflows: ["baseline_diagnostic"],
    subjectType: "diagnostic_attempt",
    subjectId: attempt?.id,
  });
  revalidatePath("/baseline");
  redirect("/baseline");
}
