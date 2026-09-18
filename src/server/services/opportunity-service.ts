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

/** Employer side of the pipeline. The database authorizes against the
 *  opportunity's organization and the transition registry decides the move. */
export async function advanceApplication(
  supabase: SupabaseClient,
  input: { applicationId: string; status: ApplicationRow["status"]; note?: string },
): Promise<ApplicationRow> {
  const { data, error } = await supabase.rpc("advance_application", {
    p_application_id: input.applicationId,
    p_status: input.status,
    p_note: input.note ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not move that application.");
  return data as ApplicationRow;
}

/** Only the applicant may answer an offer. */
export async function respondToOffer(
  supabase: SupabaseClient,
  input: { applicationId: string; accept: boolean },
): Promise<ApplicationRow> {
  const { data, error } = await supabase.rpc("respond_to_offer", {
    p_application_id: input.applicationId,
    p_accept: input.accept,
  });
  if (error) throw fromPostgresError(error, "We could not record your answer.");
  return data as ApplicationRow;
}

/** The applications an organization admin may act on, newest first. */
export async function listApplicationsForOpportunity(
  supabase: SupabaseClient,
  opportunityId: string,
): Promise<ApplicationRow[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("submitted_at", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load those applications.");
  return (data ?? []) as ApplicationRow[];
}
