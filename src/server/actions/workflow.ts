"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/server/services/actor";
import {
  claimWorkItem,
  completeMyWorkItem,
  escalateOverdueWork,
  releaseWorkItem,
} from "@/server/services/workflow-service";
import { type ActionState, errorState, successState, toActionState } from "./action-result";

/**
 * Taking and returning a piece of work. The database decides whether the
 * caller may: it checks the persona the step names, refuses work on the
 * caller's own run, and hands one item to exactly one claimant.
 *
 * Completing is deliberately separate and does not decide anything — the
 * person performs the governed engine command first, and the runtime refuses
 * to record a completion the engines do not show.
 */
export async function claimWorkItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workItemId = formData.get("workItemId");
  if (typeof workItemId !== "string") return errorState("That work is not recognised.");

  try {
    const { supabase } = await requireContext();
    await claimWorkItem(supabase, workItemId);
  } catch (error) {
    return toActionState(error);
  }

  revalidateWorkSurfaces();
  return successState("That work is yours.");
}

export async function releaseWorkItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workItemId = formData.get("workItemId");
  if (typeof workItemId !== "string") return errorState("That work is not recognised.");

  try {
    const { supabase } = await requireContext();
    await releaseWorkItem(supabase, workItemId);
  } catch (error) {
    return toActionState(error);
  }

  revalidateWorkSurfaces();
  return successState("Put back on the queue.");
}

export async function completeWorkItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workItemId = formData.get("workItemId");
  if (typeof workItemId !== "string") return errorState("That work is not recognised.");

  try {
    const { supabase } = await requireContext();
    await completeMyWorkItem(supabase, workItemId);
  } catch (error) {
    return toActionState(error);
  }

  revalidateWorkSurfaces();
  return successState("Recorded.");
}

/** Operator-only; the database refuses anybody else. */
export async function escalateOverdueWorkAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase } = await requireContext();
    const escalated = await escalateOverdueWork(supabase);
    revalidateWorkSurfaces();
    return successState(
      escalated === 0
        ? "Nothing is past its deadline."
        : `${escalated} item${escalated === 1 ? "" : "s"} escalated.`,
    );
  } catch (error) {
    return toActionState(error);
  }
}

function revalidateWorkSurfaces(): void {
  for (const path of ["/review", "/mentorship", "/organizations", "/dashboard", "/console/workflows"]) {
    revalidatePath(path);
  }
}
