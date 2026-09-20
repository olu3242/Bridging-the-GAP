"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/identity/actor";
import { fromPostgresError } from "@/domain/shared/errors";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, successState, toActionState } from "./action-result";

export async function curriculumAttemptAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "learner.dashboard.view");
    const activity = z.uuid().safeParse(form.get("activityId"));
    const operation = z.enum(["start", "save", "submit", "remediate"]).safeParse(form.get("operation"));
    if (!activity.success || !operation.success) return errorState("That lesson action is not recognized.");
    let error;
    if (operation.data === "start") {
      ({ error } = await supabase.rpc("start_curriculum_attempt", { p_activity_id: activity.data }));
    } else {
      const attempt = z.uuid().safeParse(form.get("attemptId"));
      if (!attempt.success) return errorState("That attempt is not recognized.");
      const owned = await supabase.from("curriculum_attempts").select("id").eq("id", attempt.data)
        .eq("activity_id", activity.data).eq("profile_id", actor.profileId).maybeSingle();
      if (owned.error) throw fromPostgresError(owned.error, "We could not load your attempt.");
      if (!owned.data) return errorState("That attempt is not available.");
      if (operation.data === "remediate") {
        ({ error } = await supabase.rpc("acknowledge_curriculum_remediation", { p_attempt_id: attempt.data }));
      } else {
        const output = z.string().max(4000).safeParse(form.get("output"));
        const option = z.enum(["true", "false"]).nullable().safeParse(form.get("option") || null);
        if (!output.success || !option.success) return errorState("Check your response; practice output is limited to 4,000 characters.");
        ({ error } = await supabase.rpc("save_curriculum_attempt", {
          p_attempt_id: attempt.data, p_output: output.data, p_option: option.data, p_submit: operation.data === "submit",
        }));
      }
    }
    if (error) throw fromPostgresError(error, "We could not save your lesson work.");
    revalidatePath(`/learn/${activity.data}`);
    return successState(operation.data === "submit" ? "Submitted for independent review." : "Saved.");
  } catch (error) { return toActionState(error); }
}
