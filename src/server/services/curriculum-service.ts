import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type { CurriculumLesson, CurriculumSearch, CurriculumVideo, LessonVideoMapping } from "@/domain/curriculum/types";

export async function searchCurriculum(supabase: SupabaseClient, query: string, domain: string | null, page: number): Promise<CurriculumSearch> {
  const { data, error } = await supabase.rpc("search_curriculum", { p_query: query, p_domain: domain, p_page: page });
  if (error) throw fromPostgresError(error, "We could not load the learning catalog.");
  return data as CurriculumSearch;
}

export interface CatalogLesson {
  activity_id: string;
  lesson_code: string;
  domain_code: string;
  version: number;
  status: string;
  title: string;
  objective: string;
}

/**
 * Every lesson the caller is allowed to see, for the pathway view.
 *
 * Visibility is RLS's decision, not this function's: a learner receives only
 * published lessons, an operator receives drafts too. The catalog is 112 rows at
 * full size, so this is deliberately unpaginated — pagination stays on the
 * search path where the result set is unbounded by a query string.
 */
export async function listVisibleLessons(supabase: SupabaseClient): Promise<CatalogLesson[]> {
  const { data, error } = await supabase
    .from("curriculum_lessons")
    .select("activity_id,lesson_code,domain_code,version,status,contract")
    .order("domain_code")
    .order("lesson_code");
  if (error) throw fromPostgresError(error, "We could not load the learning catalog.");
  return (data ?? []).map((row) => {
    const contract = row.contract as CurriculumLesson["contract"];
    return {
      activity_id: row.activity_id as string,
      lesson_code: row.lesson_code as string,
      domain_code: row.domain_code as string,
      version: row.version as number,
      status: row.status as string,
      title: contract?.title ?? row.lesson_code,
      objective: contract?.learning_objective?.text ?? "",
    };
  });
}

export async function getCurriculumLesson(supabase: SupabaseClient, activityId: string): Promise<CurriculumLesson | null> {
  const { data, error } = await supabase.from("curriculum_lessons").select("*").eq("activity_id", activityId).maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load that lesson.");
  return data as CurriculumLesson | null;
}

export async function getLessonVideo(supabase: SupabaseClient, activityId: string) {
  const { data, error } = await supabase.from("curriculum_lesson_video").select("*").eq("activity_id", activityId).maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load the lesson video requirements.");
  const mapping = data as LessonVideoMapping | null;
  if (!mapping?.video_id) return { mapping, video: null };
  const result = await supabase.from("curriculum_videos").select("*").eq("video_id", mapping.video_id).maybeSingle();
  if (result.error) throw fromPostgresError(result.error, "We could not load the video source.");
  return { mapping, video: result.data as CurriculumVideo | null };
}
