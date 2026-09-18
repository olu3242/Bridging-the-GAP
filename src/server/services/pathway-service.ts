import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, fromPostgresError } from "@/domain/shared/errors";
import type { LearnerModuleRow, PathwayRow, PathwayStepViewRow } from "@/lib/db/types";

export async function generatePathway(
  supabase: SupabaseClient,
  correlationId?: string,
): Promise<PathwayRow> {
  const { data, error } = await supabase.rpc("generate_pathway", {
    p_correlation_id: correlationId ?? null,
  });
  if (error) {
    if (error.message.includes("complete the baseline")) {
      throw DomainError.validation("Complete your baseline diagnostic first.");
    }
    throw fromPostgresError(error, "We could not build your pathway.");
  }
  return data as PathwayRow;
}

export async function getActivePathway(
  supabase: SupabaseClient,
  profileId: string,
): Promise<PathwayRow | null> {
  const { data, error } = await supabase
    .from("pathways")
    .select("*")
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load your pathway.");
  return (data as PathwayRow) ?? null;
}

export async function getPathwaySteps(
  supabase: SupabaseClient,
  pathwayId: string,
): Promise<PathwayStepViewRow[]> {
  const { data, error } = await supabase
    .from("pathway_step_view")
    .select("*")
    .eq("pathway_id", pathwayId)
    .order("position", { ascending: true });
  if (error) throw fromPostgresError(error, "We could not load your pathway steps.");
  return (data ?? []) as PathwayStepViewRow[];
}

export async function startStep(supabase: SupabaseClient, stepId: string): Promise<void> {
  const { error } = await supabase.rpc("start_pathway_step", { p_step_id: stepId });
  if (error) throw fromPostgresError(error, "We could not start that step.");
}

/** Enrols the learner in the step's modules and returns their progress. */
export async function openStepLearning(
  supabase: SupabaseClient,
  stepId: string,
): Promise<void> {
  const { error } = await supabase.rpc("open_step_learning", { p_step_id: stepId });
  if (error) throw fromPostgresError(error, "We could not open that step's learning.");
}

export async function getStepLearning(
  supabase: SupabaseClient,
  profileId: string,
  stepId: string,
): Promise<LearnerModuleRow[]> {
  const { data, error } = await supabase
    .from("learner_learning_view")
    .select("*")
    .eq("profile_id", profileId)
    .eq("pathway_step_id", stepId);
  if (error) throw fromPostgresError(error, "We could not load your learning.");
  return (data ?? []) as LearnerModuleRow[];
}

export async function completeActivity(
  supabase: SupabaseClient,
  activityId: string,
  output?: string,
): Promise<void> {
  const { error } = await supabase.rpc("complete_learning_activity", {
    p_activity_id: activityId,
    p_output: output ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not record that activity.");
}

export async function getModuleActivities(supabase: SupabaseClient, moduleId: string) {
  const { data, error } = await supabase
    .from("learning_activities")
    .select("id, slug, title, kind, body, requires_output, estimated_minutes, sort_order")
    .eq("module_id", moduleId)
    .order("sort_order", { ascending: true });
  if (error) throw fromPostgresError(error, "We could not load that module.");
  return data ?? [];
}

export async function getCompletedActivityIds(
  supabase: SupabaseClient,
  profileId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("learner_activity_completions")
    .select("activity_id")
    .eq("profile_id", profileId);
  if (error) throw fromPostgresError(error, "We could not load your progress.");
  return new Set((data ?? []).map((row) => row.activity_id as string));
}
