"use server";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/domain/identity/actor";
import { createOrganizationSchema } from "@/domain/identity/organization";
import { createOrganization } from "@/server/services/organization-service";
import { requireContext } from "@/server/services/actor";
import {
  type ActionState,
  errorState,
  fieldErrorsFrom,
  successState,
  toActionState,
} from "./action-result";

type OrganizationActionState = ActionState<{ id: string; slug: string }>;

export async function createOrganizationAction(
  _prev: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  try {
    const { supabase, actor, correlationId } = await requireContext();
    assertCan(actor, "organization.create");

    const parsed = createOrganizationSchema.safeParse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      type: formData.get("type"),
      website: formData.get("website") ?? "",
      countryCode: formData.get("countryCode") ?? "",
    });
    if (!parsed.success) {
      return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
    }

    const organization = await createOrganization(
      supabase,
      {
        name: parsed.data.name,
        slug: parsed.data.slug,
        type: parsed.data.type,
        website: parsed.data.website || null,
        countryCode: parsed.data.countryCode || null,
      },
      correlationId,
    );

    revalidatePath("/organizations");
    revalidatePath("/dashboard");
    return successState(`${organization.name} is ready. You are its first governing member.`, {
      id: organization.id,
      slug: organization.slug,
    });
  } catch (error) {
    return toActionState(error);
  }
}
