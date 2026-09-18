import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type {
  ApplicationRow,
  OpportunityMatchRow,
  OpportunityRow,
  PortfolioRow,
} from "@/lib/db/types";

export async function refreshMatches(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("refresh_my_matches");
  if (error) throw fromPostgresError(error, "We could not refresh your matches.");
  return Number(data ?? 0);
}

export async function listOpenOpportunities(supabase: SupabaseClient): Promise<OpportunityRow[]> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("status", "open")
    .order("closes_at", { ascending: true, nullsFirst: false });
  if (error) throw fromPostgresError(error, "We could not load opportunities.");
  return (data ?? []) as OpportunityRow[];
}

export async function listMyMatches(
  supabase: SupabaseClient,
  profileId: string,
): Promise<OpportunityMatchRow[]> {
  const { data, error } = await supabase
    .from("opportunity_matches")
    .select("*")
    .eq("profile_id", profileId)
    .order("score", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load your matches.");
  return (data ?? []) as OpportunityMatchRow[];
}

export async function listMyApplications(
  supabase: SupabaseClient,
  profileId: string,
): Promise<ApplicationRow[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("profile_id", profileId)
    .order("submitted_at", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load your applications.");
  return (data ?? []) as ApplicationRow[];
}

export async function applyToOpportunity(
  supabase: SupabaseClient,
  input: { opportunityId: string; note?: string; sharedSkillIds: string[] },
): Promise<ApplicationRow> {
  const { data, error } = await supabase.rpc("apply_to_opportunity", {
    p_opportunity_id: input.opportunityId,
    p_note: input.note ?? null,
    p_shared_skill_ids: input.sharedSkillIds,
  });
  if (error) throw fromPostgresError(error, "We could not submit your application.");
  return data as ApplicationRow;
}

export async function withdrawApplication(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<void> {
  const { error } = await supabase.rpc("withdraw_application", { p_application_id: applicationId });
  if (error) throw fromPostgresError(error, "We could not withdraw that application.");
}

/** The verified skills a learner can choose to disclose when applying. */
export async function listShareableSkills(
  supabase: SupabaseClient,
  profileId: string,
): Promise<PortfolioRow[]> {
  const { data, error } = await supabase
    .from("portfolio_view")
    .select("verified_skill_id, competency_name, competency_slug, level, profile_id, revoked_at")
    .eq("profile_id", profileId)
    .is("revoked_at", null);
  if (error) throw fromPostgresError(error, "We could not load your verified skills.");
  return (data ?? []) as PortfolioRow[];
}
