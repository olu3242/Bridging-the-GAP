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

export interface CohortSummary {
  id: string;
  slug: string;
  name: string;
  organization_id: string | null;
  member_count: number;
}

/**
 * The cohorts the caller governs. RLS on `cohorts` already restricts this to
 * an organization the caller administers (or a cohort they belong to), so the
 * query carries no authorization logic of its own.
 */
export async function listGovernedCohorts(
  supabase: SupabaseClient,
  organizationIds: readonly string[],
): Promise<CohortSummary[]> {
  if (organizationIds.length === 0) return [];
  const { data, error } = await supabase
    .from("cohorts")
    .select("id, slug, name, organization_id, cohort_members(count)")
    .in("organization_id", organizationIds)
    .order("name");
  if (error) throw fromPostgresError(error, "We could not load your cohorts.");
  return (data ?? []).map((row) => {
    const cohort = row as unknown as Omit<CohortSummary, "member_count"> & {
      cohort_members: { count: number }[] | null;
    };
    return {
      id: cohort.id,
      slug: cohort.slug,
      name: cohort.name,
      organization_id: cohort.organization_id,
      member_count: cohort.cohort_members?.[0]?.count ?? 0,
    };
  });
}

/**
 * Aggregates for each governed cohort. A cohort the database refuses -- below
 * the reporting threshold, or not governed by this caller -- yields `null`
 * rather than a zeroed row, so the UI can say why instead of showing a
 * misleading set of zeros.
 */
export async function getCohortOutcomesFor(
  supabase: SupabaseClient,
  cohorts: readonly CohortSummary[],
): Promise<Map<string, CohortOutcomeRow | null>> {
  const entries = await Promise.all(
    cohorts.map(async (cohort) => {
      const { data, error } = await supabase.rpc("cohort_outcomes", {
        p_cohort_id: cohort.id,
      });
      if (error) return [cohort.id, null] as const;
      const rows = (data ?? []) as CohortOutcomeRow[];
      return [cohort.id, rows[0] ?? null] as const;
    }),
  );
  return new Map(entries);
}
