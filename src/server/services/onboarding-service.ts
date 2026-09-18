import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import { CONSENT_POLICY_VERSION } from "@/domain/identity/onboarding";
import type { OnboardingState } from "@/domain/identity/lifecycle";
import type { LearnerProfileRow, ProfileRow } from "@/lib/db/types";

export type OnboardingStepKey = Extract<OnboardingState, "profile" | "persona" | "goals" | "consent">;

/**
 * E1/E2 — advances onboarding through the authoritative database command. The
 * step transition, the learner-profile write, consent records, the audit entry
 * and the completion notification all commit together or not at all.
 */
export async function completeOnboardingStep(
  supabase: SupabaseClient,
  step: OnboardingStepKey,
  payload: Record<string, unknown>,
  correlationId: string,
): Promise<ProfileRow> {
  const { data, error } = await supabase.rpc("complete_onboarding_step", {
    p_step: step,
    p_payload: payload,
    p_policy_version: CONSENT_POLICY_VERSION,
    p_correlation_id: correlationId,
  });
  if (error) throw fromPostgresError(error, "We could not save that step.");
  return data as ProfileRow;
}

export async function getProfile(supabase: SupabaseClient, profileId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", profileId).maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load your profile.");
  return (data as ProfileRow) ?? null;
}

export async function getLearnerProfile(
  supabase: SupabaseClient,
  profileId: string,
): Promise<LearnerProfileRow | null> {
  const { data, error } = await supabase
    .from("learner_profiles")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load your learning goals.");
  return (data as LearnerProfileRow) ?? null;
}
