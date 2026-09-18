"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/domain/identity/actor";
import { completeActivitySchema, startStepSchema } from "@/domain/pathway/pathway";
import {
  completeActivity,
  generatePathway,
  openStepLearning,
  startStep,
} from "@/server/services/pathway-service";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, fieldErrorsFrom, successState, toActionState } from "./action-result";

export async function generatePathwayAction(_prev: ActionState): Promise<ActionState> {
  try {
    const { supabase, actor, correlationId } = await requireContext();
    assertCan(actor, "learner.dashboard.view");
    await generatePathway(supabase, correlationId);
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/pathway");
  revalidatePath("/dashboard");
  redirect("/pathway?generated=1");
}

/** Starting a step also enrols its learning, so the two never drift apart. */
export async function startStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let stepId: string;
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "learner.dashboard.view");

    const parsed = startStepSchema.safeParse({ stepId: formData.get("stepId") });
    if (!parsed.success) return errorState("That step is not recognised.", fieldErrorsFrom(parsed.error));
    stepId = parsed.data.stepId;

    await startStep(supabase, stepId);
    await openStepLearning(supabase, stepId);
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/pathway");
  redirect(`/pathway/${stepId}`);
}

export async function completeActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "learner.dashboard.view");

    const parsed = completeActivitySchema.safeParse({
      activityId: formData.get("activityId"),
      output: formData.get("output") || undefined,
    });
    if (!parsed.success) {
      return errorState("Add your work before completing this step.", fieldErrorsFrom(parsed.error));
    }

    await completeActivity(supabase, parsed.data.activityId, parsed.data.output);
  } catch (error) {
    return toActionState(error);
  }

  const stepId = formData.get("stepId");
  revalidatePath("/pathway");
  if (typeof stepId === "string") revalidatePath(`/pathway/${stepId}`);
  revalidatePath("/dashboard");
  return successState("Recorded.");
}
