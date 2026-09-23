import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import { deriveReadiness, type ReadinessRow, type ReleaseSummary } from "@/domain/curriculum/readiness";

export { deriveReadiness };
export type { ReadinessRow, ReleaseSummary, LessonReadiness } from "@/domain/curriculum/readiness";

export async function getReleaseReadiness(supabase: SupabaseClient): Promise<ReleaseSummary> {
  const { data, error } = await supabase.rpc("curriculum_release_readiness");
  if (error) throw fromPostgresError(error, "We could not load curriculum release readiness.");
  return deriveReadiness((data ?? []) as ReadinessRow[]);
}

/**
 * The reason recorded against every lesson published by this release.
 *
 * Fixed rather than operator-supplied: the ledger should identify the release,
 * and a free-text box invites something vaguer than the audit trail deserves.
 * `publish_curriculum_lesson` independently requires ten characters.
 */
export const RELEASE_REASON = "BTG curriculum production release";

export interface PublishRunResult {
  published_this_run: number;
  already_published: number;
  total_published: number;
  total_lessons: number;
  blocked: number;
  blockers: { lesson_code: string; domain_code: string; reason: string; reasons: string[] }[];
  passes: number;
}

export async function publishReadyLessons(supabase: SupabaseClient, reason: string): Promise<PublishRunResult> {
  const { data, error } = await supabase.rpc("publish_ready_curriculum_lessons", { p_reason: reason });
  if (error) throw fromPostgresError(error, "We could not run the curriculum publication.");
  return data as PublishRunResult;
}
