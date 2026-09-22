import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDestination } from "@/domain/identity/journey";
import { BRAND_ROUTES } from "@/components/brand/brand";
import type { OnboardingState } from "@/domain/identity/lifecycle";
import type { Persona } from "@/domain/identity/persona";

/**
 * Where a session belongs, read from persisted state.
 *
 * Every entry point into the product resolves through this one function —
 * password sign-in, the OAuth callback, and the password-reset completion — so
 * a Google user and an email user with identical state land in exactly the
 * same place. There is no second routing model for OAuth.
 */
export async function resolveSessionDestination(
  supabase: SupabaseClient,
  userId: string,
  requested: string | null,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_state, baseline_completed_at, active_pathway_id, primary_persona")
    .eq("id", userId)
    .maybeSingle();

  const state = {
    authenticated: true,
    onboardingState: (profile?.onboarding_state as OnboardingState) ?? "not_started",
    baselineCompleted: Boolean(profile?.baseline_completed_at),
    pathwayGenerated: Boolean(profile?.active_pathway_id),
    primaryPersona: profile?.primary_persona as Persona | undefined,
  };

  const resolved = resolveDestination(state);
  // A requested destination is only honoured once every journey gate is clear.
  return resolved === BRAND_ROUTES.dashboard && requested ? requested : resolved;
}
