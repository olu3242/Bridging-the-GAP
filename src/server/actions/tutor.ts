"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/identity/actor";
import { TUTOR_INTENTS } from "@/domain/tutor/policy";
import {
  getTutorContext,
  openTutorSession,
  recordTutorTurn,
  runTutorTurn,
} from "@/server/services/tutor-service";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, fieldErrorsFrom, successState, toActionState } from "./action-result";

const askSchema = z.object({
  sessionId: z.uuid(),
  intent: z.enum(TUTOR_INTENTS),
  message: z.string().trim().min(1, "Ask something.").max(4000),
});

export async function openTutorSessionAction(
  _prev: ActionState<{ sessionId: string }>,
  formData: FormData,
): Promise<ActionState<{ sessionId: string }>> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "learner.dashboard.view");

    const stepId = formData.get("stepId");
    const moduleId = formData.get("moduleId");
    const session = await openTutorSession(supabase, {
      stepId: typeof stepId === "string" && stepId ? stepId : undefined,
      moduleId: typeof moduleId === "string" && moduleId ? moduleId : undefined,
    });

    revalidatePath("/tutor");
    return successState("Tutor ready.", { sessionId: session.id });
  } catch (error) {
    return toActionState(error);
  }
}

/**
 * One governed turn. The outcome is recorded whatever it is — delivered,
 * refused, provider unavailable or invalid — so the transcript is a complete
 * record rather than only the successes.
 */
export async function askTutorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "learner.dashboard.view");

    const parsed = askSchema.safeParse({
      sessionId: formData.get("sessionId"),
      intent: formData.get("intent"),
      message: formData.get("message"),
    });
    if (!parsed.success) {
      return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
    }

    const context = await getTutorContext(supabase, parsed.data.sessionId);

    const startedAt = Date.now();
    const result = await runTutorTurn({
      intent: parsed.data.intent,
      learnerMessage: parsed.data.message,
      context,
    });

    await recordTutorTurn(supabase, {
      sessionId: parsed.data.sessionId,
      intent: parsed.data.intent,
      learnerMessage: parsed.data.message,
      result,
      latencyMs: Date.now() - startedAt,
    });

    revalidatePath("/tutor");
    return successState(result.outcome);
  } catch (error) {
    return toActionState(error);
  }
}
