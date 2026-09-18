"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/identity/actor";
import {
  applyToOpportunity,
  refreshMatches,
  withdrawApplication,
} from "@/server/services/opportunity-service";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, fieldErrorsFrom, successState, toActionState } from "./action-result";

const applySchema = z.object({
  opportunityId: z.uuid(),
  note: z.string().trim().max(2000).optional(),
  sharedSkillIds: z.array(z.uuid()).default([]),
});

export async function refreshMatchesAction(_prev: ActionState): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "opportunity.apply_own");
    const count = await refreshMatches(supabase);
    revalidatePath("/opportunities");
    return successState(`Scored ${count} open opportunities against your verified skills.`);
  } catch (error) {
    return toActionState(error);
  }
}

/**
 * Applying discloses only the verified skills the learner names. The database
 * refuses any id that is not their own live skill.
 */
export async function applyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "opportunity.apply_own");

    const parsed = applySchema.safeParse({
      opportunityId: formData.get("opportunityId"),
      note: formData.get("note") || undefined,
      sharedSkillIds: formData.getAll("sharedSkillIds").map(String).filter(Boolean),
    });
    if (!parsed.success) {
      return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
    }

    await applyToOpportunity(supabase, {
      opportunityId: parsed.data.opportunityId,
      note: parsed.data.note,
      sharedSkillIds: parsed.data.sharedSkillIds,
    });
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/opportunities");
  redirect("/opportunities?applied=1");
}

export async function withdrawApplicationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "opportunity.apply_own");
    const applicationId = formData.get("applicationId");
    if (typeof applicationId !== "string") return errorState("That application is not recognised.");
    await withdrawApplication(supabase, applicationId);
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath("/opportunities");
  return successState("Application withdrawn.");
}
