import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type { MentorRecommendationRow, MentorshipRow } from "@/lib/db/types";

export async function recommendMentors(
  supabase: SupabaseClient,
  limit = 5,
): Promise<MentorRecommendationRow[]> {
  const { data, error } = await supabase.rpc("recommend_mentors", { p_limit: limit });
  if (error) throw fromPostgresError(error, "We could not load mentor recommendations.");
  return (data ?? []) as MentorRecommendationRow[];
}

export async function listMyMentorships(
  supabase: SupabaseClient,
  profileId: string,
): Promise<MentorshipRow[]> {
  const { data, error } = await supabase
    .from("mentorships")
    .select("*")
    .or(`learner_profile_id.eq.${profileId},mentor_profile_id.eq.${profileId}`)
    .order("requested_at", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load your mentorships.");
  return (data ?? []) as MentorshipRow[];
}

export async function requestMentorship(
  supabase: SupabaseClient,
  input: { mentorProfileId: string; competencyId?: string; message?: string },
): Promise<MentorshipRow> {
  const { data, error } = await supabase.rpc("request_mentorship", {
    p_mentor_profile_id: input.mentorProfileId,
    p_competency_id: input.competencyId ?? null,
    p_message: input.message ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not send that request.");
  return data as MentorshipRow;
}

export async function respondToMentorship(
  supabase: SupabaseClient,
  input: { mentorshipId: string; accept: boolean; response?: string },
): Promise<void> {
  const { error } = await supabase.rpc("respond_to_mentorship", {
    p_mentorship_id: input.mentorshipId,
    p_accept: input.accept,
    p_response: input.response ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not record that response.");
}

/** Cohorts the learner actually belongs to — the whole community scope. */
export async function listMyCohorts(supabase: SupabaseClient, profileId: string) {
  const { data, error } = await supabase
    .from("cohort_members")
    .select("joined_at, cohorts(id, slug, name, description, starts_on, ends_on)")
    .eq("profile_id", profileId);
  if (error) throw fromPostgresError(error, "We could not load your cohorts.");
  return data ?? [];
}
