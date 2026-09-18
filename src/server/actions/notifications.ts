"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/identity/actor";
import { AUDIT_ACTIONS } from "@/domain/shared/audit";
import { markNotificationRead } from "@/server/services/notification-service";
import { recordAudit } from "@/server/services/audit-service";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, successState, toActionState } from "./action-result";

const schema = z.object({ notificationId: z.uuid() });

export async function markNotificationReadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, actor, correlationId } = await requireContext();
    assertCan(actor, "notification.read_own");

    const parsed = schema.safeParse({ notificationId: formData.get("notificationId") });
    if (!parsed.success) return errorState("That notification is not recognised.", undefined, "VALIDATION");

    await markNotificationRead(supabase, actor.profileId, parsed.data.notificationId);
    await recordAudit(supabase, actor, {
      action: AUDIT_ACTIONS.notificationRead,
      objectType: "notification",
      objectId: parsed.data.notificationId,
      correlationId,
      workflow: "notifications",
    });

    revalidatePath("/dashboard");
    return successState("Marked as read.");
  } catch (error) {
    return toActionState(error);
  }
}
