import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";

/**
 * The application's side of the Workflow OS.
 *
 * Three narrow database commands, each scoped to the calling learner by
 * construction (they read `auth.uid()`, never a parameter):
 *
 *   ensure_my_workflow    declare intent — one instance per learner per
 *                         self-startable workflow, so a refresh, a retry or a
 *                         double submit all land on the same run
 *   signal_my_workflows   tell the runtime a domain entity of theirs moved
 *   advance_my_workflows  drain their own queued work
 *
 * None of them mutates domain state and none chooses what runs: the pinned
 * definition version names the steps, the handler allowlist decides which
 * classes may execute, the command allowlist bounds what a step may invoke, and
 * every completion is re-verified against the engines before it is recorded.
 *
 * A deployed invoker is still the right way to run this at scale. Calling
 * `advance` from the request that caused the work means the product does not
 * depend on one existing.
 */

/** A self-startable workflow, as the database's allowlist names it. */
export type SelfStartableWorkflow =
  | "baseline_diagnostic"
  | "pathway_generation"
  | "matching";

export interface WorkflowContinuation {
  /** Instances the learner had open that this request advanced. */
  instances: number;
  completed: number;
  waiting: number;
  retried: number;
  failed: number;
}

export interface WorkflowStateRow {
  instance_id: string;
  workflow: string;
  workflow_name: string;
  version: number;
  instance_status: string;
  started_at: string | null;
  settled_at: string | null;
  failure: string | null;
  work_item_id: string | null;
  step_key: string | null;
  step_ordinal: number | null;
  item_type: string | null;
  handler: string | null;
  work_item_status: string | null;
  owner_kind: string | null;
  owner_persona: string | null;
  attempts: number | null;
  deadline_at: string | null;
  work_item_failure: string | null;
  step_count: number;
}

export async function ensureWorkflow(
  supabase: SupabaseClient,
  definitionKey: SelfStartableWorkflow,
): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_my_workflow", {
    p_definition_key: definitionKey,
  });
  if (error) throw fromPostgresError(error, "We could not start that piece of work.");
  return (data as { id: string }).id;
}

export async function signalWorkflows(
  supabase: SupabaseClient,
  subjectType?: string,
  subjectId?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("signal_my_workflows", {
    p_subject_type: subjectType ?? null,
    p_subject_id: subjectId ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not record that progress.");
  return Number(data ?? 0);
}

export async function advanceWorkflows(
  supabase: SupabaseClient,
  batch = 5,
): Promise<WorkflowContinuation> {
  const { data, error } = await supabase.rpc("advance_my_workflows", { p_batch: batch });
  if (error) throw fromPostgresError(error, "We could not continue your work.");
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, number> | null;
  return {
    instances: Number(row?.instances ?? 0),
    completed: Number(row?.completed ?? 0),
    waiting: Number(row?.waiting ?? 0),
    retried: Number(row?.retried ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}

export async function getWorkflowState(
  supabase: SupabaseClient,
  profileId: string,
): Promise<WorkflowStateRow[]> {
  const { data, error } = await supabase
    .from("my_workflow_state")
    .select("*")
    .eq("profile_id", profileId)
    .order("started_at", { ascending: false })
    .order("step_ordinal", { ascending: true });
  if (error) throw fromPostgresError(error, "We could not load your current work.");
  return (data ?? []) as WorkflowStateRow[];
}

/**
 * The continuation an action runs after its governed command has already
 * succeeded: declare the workflows this moment starts, tell the runtime what
 * moved, then drain.
 *
 * Deliberately non-throwing. The learner's own command committed; orchestration
 * is what happens next, and failing the action here would report an error for
 * work that succeeded and would tempt the learner into a duplicate submit. A
 * continuation that does not run leaves the work queued and visible, which the
 * invoker or the next request picks up — a stalled step is inspectable state,
 * not a 500.
 */
export async function continueLearnerWork(
  supabase: SupabaseClient,
  options: {
    workflows?: SelfStartableWorkflow[];
    subjectType?: string;
    subjectId?: string;
  } = {},
): Promise<WorkflowContinuation | null> {
  try {
    for (const workflow of options.workflows ?? []) {
      await ensureWorkflow(supabase, workflow);
    }
    await signalWorkflows(supabase, options.subjectType, options.subjectId);
    return await advanceWorkflows(supabase);
  } catch (error) {
    console.error("workflow continuation did not run", {
      workflows: options.workflows,
      subjectType: options.subjectType,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
