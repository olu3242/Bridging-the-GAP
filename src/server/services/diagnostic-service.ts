import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, fromPostgresError } from "@/domain/shared/errors";
import type {
  DiagnosticAttemptRow,
  DiagnosticRow,
  LearnerCompetencyGapRow,
  NextQuestionRow,
} from "@/lib/db/types";

/**
 * E3 — every write goes through a database command so grading, level
 * estimation and the baseline write cannot be influenced by the client.
 */
export async function startBaselineAttempt(
  supabase: SupabaseClient,
  slug?: string,
): Promise<DiagnosticAttemptRow> {
  const { data, error } = await supabase.rpc("start_diagnostic_attempt", { p_slug: slug ?? null });
  if (error) {
    const domainError = fromPostgresError(error, "We could not start your baseline.");
    if (error.code === "P0002") {
      throw DomainError.notFound("No baseline diagnostic is published yet.");
    }
    throw domainError;
  }
  return data as DiagnosticAttemptRow;
}

/** The next question in the adaptive walk, or null when the probe is complete. */
export async function nextQuestion(
  supabase: SupabaseClient,
  attemptId: string,
): Promise<NextQuestionRow | null> {
  const { data, error } = await supabase.rpc("next_diagnostic_question", { p_attempt_id: attemptId });
  if (error) throw fromPostgresError(error, "We could not load the next question.");
  const rows = (data ?? []) as NextQuestionRow[];
  return rows[0] ?? null;
}

export async function answerQuestion(
  supabase: SupabaseClient,
  input: { attemptId: string; questionId: string; selectedOptionIds: string[]; elapsedMs?: number },
): Promise<void> {
  const { error } = await supabase.rpc("answer_diagnostic_question", {
    p_attempt_id: input.attemptId,
    p_question_id: input.questionId,
    p_selected: input.selectedOptionIds,
    p_elapsed_ms: input.elapsedMs ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not record that answer.");
}

export async function submitAttempt(
  supabase: SupabaseClient,
  attemptId: string,
): Promise<DiagnosticAttemptRow> {
  const { data, error } = await supabase.rpc("submit_diagnostic_attempt", { p_attempt_id: attemptId });
  if (error) throw fromPostgresError(error, "We could not submit your baseline.");
  return data as DiagnosticAttemptRow;
}

export async function abandonAttempt(supabase: SupabaseClient, attemptId: string): Promise<void> {
  const { error } = await supabase.rpc("abandon_diagnostic_attempt", { p_attempt_id: attemptId });
  if (error) throw fromPostgresError(error, "We could not close that attempt.");
}

export async function getBaselineDiagnostic(supabase: SupabaseClient): Promise<DiagnosticRow | null> {
  const { data, error } = await supabase
    .from("diagnostics")
    .select("*")
    .eq("is_baseline", true)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load the baseline diagnostic.");
  return (data as DiagnosticRow) ?? null;
}

export async function getLatestAttempt(
  supabase: SupabaseClient,
  profileId: string,
): Promise<DiagnosticAttemptRow | null> {
  const { data, error } = await supabase
    .from("diagnostic_attempts")
    .select("*")
    .eq("profile_id", profileId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load your baseline attempt.");
  return (data as DiagnosticAttemptRow) ?? null;
}

export async function getOpenAttempt(
  supabase: SupabaseClient,
  profileId: string,
): Promise<DiagnosticAttemptRow | null> {
  const { data, error } = await supabase
    .from("diagnostic_attempts")
    .select("*")
    .eq("profile_id", profileId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load your baseline attempt.");
  return (data as DiagnosticAttemptRow) ?? null;
}

/** How many distinct competencies a diagnostic probes. */
export async function countProbedCompetencies(
  supabase: SupabaseClient,
  diagnosticId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("diagnostic_questions")
    .select("competency_id")
    .eq("diagnostic_id", diagnosticId);
  if (error) throw fromPostgresError(error, "We could not load the baseline diagnostic.");
  return new Set((data ?? []).map((row) => row.competency_id as string)).size;
}

/** E3/E4 read model: measured level vs target, with unmet prerequisites. */
export async function getCompetencyGaps(
  supabase: SupabaseClient,
  profileId: string,
): Promise<LearnerCompetencyGapRow[]> {
  const { data, error } = await supabase
    .from("learner_competency_gaps")
    .select("*")
    .eq("profile_id", profileId);
  if (error) throw fromPostgresError(error, "We could not load your competency profile.");
  return (data ?? []) as LearnerCompetencyGapRow[];
}
