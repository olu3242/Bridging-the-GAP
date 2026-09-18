"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/domain/identity/actor";
import { assignProjectSchema, submitEvidenceSchema } from "@/domain/evidence/verification";
import { assignProject, submitEvidence } from "@/server/services/project-service";
import { requireContext } from "@/server/services/actor";
import { type ActionState, errorState, fieldErrorsFrom, toActionState } from "./action-result";

export async function assignProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let projectId: string;
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "project.manage_own");

    const parsed = assignProjectSchema.safeParse({
      briefSlug: formData.get("briefSlug"),
      stepId: formData.get("stepId") || undefined,
    });
    if (!parsed.success) return errorState("That brief is not recognised.", fieldErrorsFrom(parsed.error));

    const project = await assignProject(supabase, parsed.data.briefSlug, parsed.data.stepId);
    projectId = project.id;
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/projects");
  revalidatePath("/pathway");
  redirect(`/projects/${projectId}`);
}

export async function submitEvidenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let projectId: string;
  try {
    const { supabase, actor } = await requireContext();
    assertCan(actor, "evidence.submit_own");

    const parsed = submitEvidenceSchema.safeParse({
      projectId: formData.get("projectId"),
      summary: formData.get("summary"),
      artifactUrl: formData.get("artifactUrl") ?? "",
      aiDeclared: formData.get("aiDeclared") === "on",
      aiNote: formData.get("aiNote") ?? "",
    });
    if (!parsed.success) {
      return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
    }
    projectId = parsed.data.projectId;

    await submitEvidence(supabase, {
      projectId: parsed.data.projectId,
      summary: parsed.data.summary,
      artifactUrl: parsed.data.artifactUrl || undefined,
      aiDeclared: parsed.data.aiDeclared,
      aiNote: parsed.data.aiNote || undefined,
    });
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/pathway");
  redirect(`/projects/${projectId}?submitted=1`);
}
