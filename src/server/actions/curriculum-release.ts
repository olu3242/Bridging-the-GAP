"use server";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/domain/identity/actor";
import { requireContext } from "@/server/services/actor";
import { publishReadyLessons, RELEASE_REASON } from "@/server/services/curriculum-release-service";
import { type ActionState, errorState, successState, toActionState } from "./action-result";

/**
 * Publishes every lesson whose gates are already satisfied.
 *
 * This holds no authority of its own. It calls
 * `publish_ready_curriculum_lessons`, which calls `publish_curriculum_lesson`
 * once per lesson, which is the only thing in the system that can move a lesson
 * to published — and which re-checks operator identity server-side regardless of
 * what this action asserts.
 */
type PublishActionState = ActionState<{ published: number; blocked: number }>;

export async function publishReadyLessonsAction(
  _previous: PublishActionState,
  _form: FormData,
): Promise<PublishActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "operator.console.view");
    const result = await publishReadyLessons(supabase, RELEASE_REASON);
    revalidatePath("/console/curriculum");
    revalidatePath("/learn");
    if (result.published_this_run === 0) {
      return errorState(
        result.blocked === 0
          ? "Every lesson is already published. Nothing to do."
          : `No lesson could be published. ${result.blocked} lessons are still held by an unmet gate; the blocker for each is listed below.`,
      );
    }
    return successState(
      `Published ${result.published_this_run} lesson${result.published_this_run === 1 ? "" : "s"}. ${result.blocked} still held.`,
      { published: result.published_this_run, blocked: result.blocked },
    );
  } catch (error) {
    return toActionState(error, "We could not run the curriculum publication.");
  }
}
