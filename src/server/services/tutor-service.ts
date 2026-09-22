import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import {
  TUTOR_INSTRUCTION_VERSION,
  TUTOR_POLICY_VERSION,
  buildTutorInstruction,
  deterministicCoaching,
  guardTutorOutput,
  screenLearnerMessage,
  tutorOutputSchema,
  type TutorIntent,
  type TutorOutcome,
  type TutorOutput,
} from "@/domain/tutor/policy";
import type { TutorSessionRow, TutorTurnRow } from "@/lib/db/types";

/**
 * The model this tutor runs on. Opus 5 has thinking on by default, so the
 * `thinking` parameter is deliberately omitted.
 */
const TUTOR_MODEL = "claude-opus-5";

/** Coaching turns are deliberately short; 2000 is the reason, not a guess. */
const TUTOR_MAX_TOKENS = 2000;

export interface TutorContext {
  competency?: { name: string; description: string | null; target_level: number } | null;
  measured_level?: number | null;
  step?: { position: number; status: string; from_level: number; target_level: number; rationale: string } | null;
  module?: { title: string; summary: string | null } | null;
  activities_completed?: number;
  goal?: string | null;
}

export interface TutorTurnResult {
  outcome: TutorOutcome;
  output: TutorOutput;
  refusalReason?: string;
  model?: string;
}

export async function openTutorSession(
  supabase: SupabaseClient,
  input: { stepId?: string; moduleId?: string },
): Promise<TutorSessionRow> {
  const { data, error } = await supabase.rpc("open_tutor_session", {
    p_step_id: input.stepId ?? null,
    p_module_id: input.moduleId ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not open a tutor session.");
  return data as TutorSessionRow;
}

export async function getTutorContext(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<TutorContext> {
  const { data, error } = await supabase.rpc("tutor_context", { p_session_id: sessionId });
  if (error) throw fromPostgresError(error, "We could not load your tutor context.");
  return (data ?? {}) as TutorContext;
}

export async function listTutorTurns(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<TutorTurnRow[]> {
  const { data, error } = await supabase
    .from("tutor_turns")
    .select("id, ordinal, intent, learner_message, tutor_response, outcome, refusal_reason, created_at")
    .eq("session_id", sessionId)
    .order("ordinal", { ascending: true });
  if (error) throw fromPostgresError(error, "We could not load the conversation.");
  return (data ?? []) as TutorTurnRow[];
}

/** True when a credential is present for the provider to use. */
export function isTutorProviderConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function contextForFallback(context: TutorContext) {
  return {
    competencyName: context.competency?.name,
    measuredLevel: context.measured_level ?? null,
    targetLevel: context.step?.target_level ?? context.competency?.target_level ?? null,
    moduleTitle: context.module?.title ?? null,
    activitiesCompleted: context.activities_completed ?? 0,
    goal: context.goal ?? null,
    stepRationale: context.step?.rationale ?? null,
  };
}

/**
 * Runs one tutor turn through the full governed chain:
 *
 *   screen the request -> approved context -> versioned instruction ->
 *   model -> schema validation -> deterministic guard -> persisted turn
 *
 * Every path returns a recorded turn. A refusal, an unreachable provider and
 * an invalid response are all outcomes, never silent failures.
 */
export async function runTutorTurn(input: {
  intent: TutorIntent;
  learnerMessage: string;
  context: TutorContext;
}): Promise<TutorTurnResult> {
  const screen = screenLearnerMessage(input.learnerMessage);
  if (!screen.allowed) {
    return {
      outcome: screen.outcome!,
      refusalReason: screen.reason,
      output: {
        response: screen.alternative ?? "I can't help with that.",
        follow_up_question: null,
        uncertainty: null,
        suggested_next_action: null,
      },
    };
  }

  if (!isTutorProviderConfigured()) {
    return {
      outcome: "provider_unavailable",
      refusalReason: "No model credential is configured for this environment.",
      output: deterministicCoaching(input.intent, contextForFallback(input.context)),
    };
  }

  const client = new Anthropic();

  try {
    const message = await client.messages.parse({
      model: TUTOR_MODEL,
      max_tokens: TUTOR_MAX_TOKENS,
      system: buildTutorInstruction(input.intent),
      output_config: { format: zodOutputFormat(tutorOutputSchema) },
      messages: [
        {
          role: "user",
          content: [
            "Learner context (approved, read-only):",
            JSON.stringify(input.context),
            "",
            "Learner message:",
            input.learnerMessage,
          ].join("\n"),
        },
      ],
    });

    // A policy decline from the provider is an outcome, not an exception.
    if (message.stop_reason === "refusal") {
      return {
        outcome: "refused_policy",
        refusalReason: `The provider declined this request (${message.stop_details?.category ?? "unspecified"}).`,
        output: deterministicCoaching(input.intent, contextForFallback(input.context)),
        model: message.model,
      };
    }

    const parsed = tutorOutputSchema.safeParse(message.parsed_output);
    if (!parsed.success) {
      return {
        outcome: "invalid_output",
        refusalReason: `The tutor's response did not match the required shape: ${parsed.error.issues[0]?.message}`,
        output: deterministicCoaching(input.intent, contextForFallback(input.context)),
        model: message.model,
      };
    }

    const guard = guardTutorOutput(parsed.data);
    if (!guard.ok) {
      return {
        outcome: guard.outcome!,
        refusalReason: guard.reason,
        output: {
          response:
            "I started to say something I'm not allowed to claim — only a human reviewer can verify a skill or issue a credential. Ask me to explain, question or critique instead.",
          follow_up_question: null,
          uncertainty: null,
          suggested_next_action: "Ask me to critique the work you have written so far.",
        },
        model: message.model,
      };
    }

    return { outcome: "delivered", output: parsed.data, model: message.model };
  } catch (error) {
    // Most specific first. Anything that means "no usable model right now"
    // becomes provider_unavailable and falls back to the deterministic path.
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.RateLimitError ||
      error instanceof Anthropic.APIConnectionError ||
      (error instanceof Anthropic.APIError && (error.status ?? 500) >= 500)
    ) {
      return {
        outcome: "provider_unavailable",
        refusalReason: `The model provider was unreachable (${error.constructor.name}).`,
        output: deterministicCoaching(input.intent, contextForFallback(input.context)),
      };
    }
    if (error instanceof Anthropic.APIError) {
      return {
        outcome: "invalid_output",
        refusalReason: `The provider rejected the request (${error.status}).`,
        output: deterministicCoaching(input.intent, contextForFallback(input.context)),
      };
    }
    throw error;
  }
}

/** Persists the turn — including refusals — with its governance metadata. */
export async function recordTutorTurn(
  supabase: SupabaseClient,
  input: {
    sessionId: string;
    intent: TutorIntent;
    learnerMessage: string;
    result: TutorTurnResult;
    latencyMs?: number;
  },
): Promise<void> {
  const { error } = await supabase.rpc("record_tutor_turn", {
    p_session_id: input.sessionId,
    p_intent: input.intent,
    p_learner_message: input.learnerMessage,
    p_outcome: input.result.outcome,
    p_policy_version: TUTOR_POLICY_VERSION,
    p_instruction_version: TUTOR_INSTRUCTION_VERSION,
    p_tutor_response: input.result.output.response,
    p_model: input.result.model ?? null,
    p_refusal_reason: input.result.refusalReason ?? null,
    p_latency_ms: input.latencyMs ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not record that tutor turn.");
}
