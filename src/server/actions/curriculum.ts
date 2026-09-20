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
    const activity = z.guid().safeParse(form.get("activityId"));
    const operation = z.enum(["start", "save", "submit", "remediate", "complete"]).safeParse(form.get("operation"));
    if (!activity.success || !operation.success) return errorState("That lesson action is not recognized.");
    let error;
    if (operation.data === "complete") {
      ({ error } = await supabase.rpc("complete_curriculum_lesson", { p_activity_id: activity.data }));
    } else if (operation.data === "start") {
      ({ error } = await supabase.rpc("start_curriculum_attempt", { p_activity_id: activity.data }));
    } else {
      const attempt = z.guid().safeParse(form.get("attemptId"));
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

const playbackSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("begin"), activityId: z.guid(), position: z.number().finite().nonnegative() }),
  z.object({ kind: z.literal("interval"), activityId: z.guid(), requestId: z.guid(), from: z.number().finite().nonnegative(), to: z.number().finite().nonnegative() }),
  z.object({ kind: z.literal("viewed"), activityId: z.guid() }),
  z.object({ kind: z.literal("resource_opened"), activityId: z.guid() }),
]);

export async function curriculumPlaybackAction(input: unknown): Promise<ActionState> {
  try {
    const parsed = playbackSchema.safeParse(input);
    if (!parsed.success) return errorState("Invalid playback update.");
    const { supabase, actor } = await requireContext();
    assertCan(actor, "learner.dashboard.view");
    const value = parsed.data;
    const result = value.kind === "begin" ? await supabase.rpc("begin_curriculum_playback", { p_activity_id: value.activityId, p_position: value.position }) :
      value.kind === "interval" ? await supabase.rpc("record_curriculum_playback", { p_activity_id: value.activityId, p_request_id: value.requestId, p_from: value.from, p_to: value.to }) :
      await supabase.rpc("record_curriculum_engagement", { p_activity_id: value.activityId, p_kind: value.kind, p_resource_key: value.kind === "viewed" ? "" : "video" });
    if (result.error) throw fromPostgresError(result.error, "Playback progress could not be saved. Resume playback to retry.");
    return successState("Progress saved.");
  } catch (error) { return toActionState(error); }
}
