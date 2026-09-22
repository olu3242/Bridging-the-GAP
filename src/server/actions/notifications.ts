"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/identity/actor";
import { markNotificationRead } from "@/server/services/notification-service";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, successState, toActionState } from "./action-result";

const schema = z.object({ notificationId: z.uuid() });

export async function markNotificationReadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "notification.read_own");

    const parsed = schema.safeParse({ notificationId: formData.get("notificationId") });
    if (!parsed.success) return errorState("That notification is not recognised.", undefined, "VALIDATION");

    // The command records the ledger entry itself, in the same transaction.
    await markNotificationRead(supabase, parsed.data.notificationId);

    revalidatePath("/dashboard");
    return successState("Marked as read.");
  } catch (error) {
    return toActionState(error);
  }
}
