"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/identity/actor";
import {
  consentStepSchema,
  goalsStepSchema,
  personaStepSchema,
  profileStepSchema,
} from "@/domain/identity/onboarding";
import { completeOnboardingStep, type OnboardingStepKey } from "@/server/services/onboarding-service";
import { requireContext } from "@/server/services/actor";
import { continueLearnerWork } from "@/server/services/workflow-service";
import { type ActionState, errorState, fieldErrorsFrom, toActionState } from "./action-result";

const STEP_SCHEMAS = {
  profile: profileStepSchema,
  persona: personaStepSchema,
  goals: goalsStepSchema,
  consent: consentStepSchema,
} as const;

function readStep(formData: FormData): OnboardingStepKey | null {
  const step = formData.get("step");
  return typeof step === "string" && step in STEP_SCHEMAS ? (step as OnboardingStepKey) : null;
}

function payloadFor(step: OnboardingStepKey, formData: FormData): Record<string, unknown> {
  switch (step) {
    case "profile":
      return {
        displayName: formData.get("displayName"),
        fullName: formData.get("fullName") ?? "",
        countryCode: formData.get("countryCode") ?? "",
        timezone: formData.get("timezone") || "UTC",
      };
    case "persona":
      return {
        primaryPersona: formData.get("primaryPersona"),
        headline: formData.get("headline") ?? "",
      };
    case "goals":
      return {
        primaryGoal: formData.get("primaryGoal"),
        focusAreas: formData
          .getAll("focusAreas")
          .map((v) => String(v).trim())
          .filter(Boolean),
        experienceLevel: formData.get("experienceLevel") || "beginner",
        weeklyHours: formData.get("weeklyHours"),
        targetOutcome: formData.get("targetOutcome") ?? "",
        educationStage: formData.get("educationStage") ?? "",
      };
    case "consent":
      return {
        terms: formData.get("terms") === "on",
        privacy: formData.get("privacy") === "on",
        aiProcessing: formData.get("aiProcessing") === "on",
        evidenceSharing: formData.get("evidenceSharing") === "on",
        marketing: formData.get("marketing") === "on",
      };
  }
}

/**
 * UI → validation → actor → authorization → domain command → persistence →
 * audit (inside the command) → redirect. No step is trusted from the client:
 * the database rejects a step the learner is not standing on.
 */
export async function submitOnboardingStepAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const step = readStep(formData);
  if (!step) return errorState("That onboarding step is not recognised.", undefined, "VALIDATION");

  let completed = false;
  try {
    const { supabase, actor, correlationId } = await requireContext();
    assertCan(actor, "onboarding.complete_own");

    const schema = STEP_SCHEMAS[step] as z.ZodType;
    const parsed = schema.safeParse(payloadFor(step, formData));
    if (!parsed.success) {
      return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
    }

    const profile = await completeOnboardingStep(
      supabase,
      step,
      parsed.data as Record<string, unknown>,
      correlationId,
    );
    completed = profile.onboarding_state === "completed";
    if (completed) {
      /* The journey becomes a durable run at the moment the learner is a
         learner. Everything after this is the coordinator waiting on engine
         state, so the dashboard can always say where they are and what is
         next. */
      await continueLearnerWork(supabase, { workflows: ["BTG_LEARNER_TO_OPPORTUNITY"] });
    }
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/onboarding");
  revalidatePath("/dashboard");
  if (completed) redirect("/dashboard?welcome=1");
  redirect("/onboarding");
}
