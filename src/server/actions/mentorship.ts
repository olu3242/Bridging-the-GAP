"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/identity/actor";
import { requestMentorship, respondToMentorship } from "@/server/services/mentorship-service";
import { requireContext } from "@/server/services/actor";
import { continueLearnerWork } from "@/server/services/workflow-service";
import { type ActionState, errorState, fieldErrorsFrom, successState, toActionState } from "./action-result";

const requestSchema = z.object({
  mentorProfileId: z.uuid(),
  message: z.string().trim().max(1000).optional(),
});

const respondSchema = z.object({
  mentorshipId: z.uuid(),
  accept: z.boolean(),
  response: z.string().trim().max(1000).optional(),
});

export async function requestMentorshipAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "mentorship.request_own");

    const parsed = requestSchema.safeParse({
      mentorProfileId: formData.get("mentorProfileId"),
      message: formData.get("message") || undefined,
    });
    if (!parsed.success) return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

    await requestMentorship(supabase, parsed.data);
    // The domain moved; let the runtime notice and carry the journey on.
    await continueLearnerWork(supabase);
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/mentorship");
  return successState("Request sent. The mentor decides whether to take it on.");
}

export async function respondToMentorshipAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "mentorship.mentor_own");

    const parsed = respondSchema.safeParse({
      mentorshipId: formData.get("mentorshipId"),
      accept: formData.get("accept") === "true",
      response: formData.get("response") || undefined,
    });
    if (!parsed.success) return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

    await respondToMentorship(supabase, parsed.data);
    revalidatePath("/mentorship");
    return successState(parsed.data.accept ? "Accepted." : "Declined.");
  } catch (error) {
    return toActionState(error);
  }
}
