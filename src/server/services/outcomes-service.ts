import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type {
  CohortOutcomeRow,
  LearnerOutcomeRow,
  OutcomeTimelineRow,
} from "@/lib/db/types";

/**
 * E17. Every figure returned here comes from a canonical engine table or the
 * audit ledger. Nothing is estimated, projected or cached, so a number shown
 * to a learner can always be traced to the record that produced it.
 */
export async function getLearnerOutcomes(
  supabase: SupabaseClient,
  profileId: string,
): Promise<LearnerOutcomeRow | null> {
  const { data, error } = await supabase
    .from("learner_outcome_view")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load your progress.");
  return (data as LearnerOutcomeRow | null) ?? null;
}

export async function getOutcomeTimeline(
  supabase: SupabaseClient,
  profileId: string,
  limit = 40,
): Promise<OutcomeTimelineRow[]> {
  const { data, error } = await supabase
    .from("outcome_timeline_view")
    .select("*")
    .eq("profile_id", profileId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw fromPostgresError(error, "We could not load your history.");
  return (data ?? []) as OutcomeTimelineRow[];
}

/**
 * Aggregates only, and only for a cohort the caller governs. The database
 * refuses a cohort the caller does not administer and refuses to report one
 * small enough for an aggregate to identify an individual.
 */
export async function getCohortOutcomes(
  supabase: SupabaseClient,
  cohortId: string,
): Promise<CohortOutcomeRow> {
  const { data, error } = await supabase.rpc("cohort_outcomes", { p_cohort_id: cohortId });
  if (error) throw fromPostgresError(error, "We could not load those cohort outcomes.");
  const rows = (data ?? []) as CohortOutcomeRow[];
  return rows[0] as CohortOutcomeRow;
}
