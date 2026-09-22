import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type { CurriculumLesson, CurriculumSearch, CurriculumVideo, LessonVideoMapping } from "@/domain/curriculum/types";

export async function searchCurriculum(supabase: SupabaseClient, query: string, domain: string | null, page: number): Promise<CurriculumSearch> {
  const { data, error } = await supabase.rpc("search_curriculum", { p_query: query, p_domain: domain, p_page: page });
  if (error) throw fromPostgresError(error, "We could not load the learning catalog.");
  return data as CurriculumSearch;
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
