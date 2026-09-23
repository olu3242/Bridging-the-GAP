import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { tutorOutputSchema, type TutorOutput } from "@/domain/tutor/policy";
import {
  hasTutorCredential,
  resolveTutorModel,
  resolveTutorProvider,
  type TutorEnv,
  type TutorProviderName,
} from "@/domain/tutor/provider-config";

/**
 * The model boundary for the tutor.
 *
 * Everything above this module — screening, the versioned instruction, schema
 * validation, the deterministic guard, refusal handling and persistence — is
 * provider-agnostic and unchanged. This module's only job is to take an
 * instruction plus approved context and return one of four normalised results,
 * so that swapping providers cannot quietly change the governed flow.
 *
 * Credentials are read here and only here, on the server. No key is ever
 * returned to a caller or embedded in a response.
 */

export type ProviderResult =
  | { kind: "output"; parsed: unknown; model: string }
  | { kind: "refusal"; reason: string; model: string }
  | { kind: "invalid"; reason: string; model?: string }
  | { kind: "unavailable"; reason: string };

/** Coaching turns are deliberately short; 2000 is the reason, not a guess. */
const MAX_OUTPUT_TOKENS = 2000;

/**
 * Reads the configuration literally, per variable, on every call.
 *
 * Deliberately not destructured or cached: these are server-side runtime reads,
 * and a cached copy would survive a redeploy's configuration change.
 */
function env(): TutorEnv {
  return {
    BTG_AI_PROVIDER: process.env.BTG_AI_PROVIDER,
    BTG_TUTOR_MODEL: process.env.BTG_TUTOR_MODEL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  };
}

export function tutorProvider(): TutorProviderName {
  return resolveTutorProvider(env());
}

export function tutorModel(): string {
  return resolveTutorModel(env());
}

/** True when a credential is present for the configured provider. */
export function isTutorProviderConfigured(): boolean {
  return hasTutorCredential(env());
}

/**
 * Finds a provider-side refusal in a Responses output.
 *
 * Walked structurally rather than through the SDK's union types: a refusal is a
 * content part with `type: "refusal"`, and treating the tree as unknown keeps
 * this working when the SDK reshapes those unions between minor versions.
 */
function findRefusal(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as { type?: unknown; refusal?: unknown };
      if (record.type === "refusal") return String(record.refusal ?? "unspecified");
    }
  }
  return null;
}

function userContent(context: unknown, learnerMessage: string): string {
  return [
    "Learner context (approved, read-only):",
    JSON.stringify(context),
    "",
    "Learner message:",
    learnerMessage,
  ].join("\n");
}

async function runOpenAI(instruction: string, context: unknown, learnerMessage: string): Promise<ProviderResult> {
  const model = tutorModel();
  const client = new OpenAI();
  try {
    const response = await client.responses.parse({
      model,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      instructions: instruction,
      input: [{ role: "user", content: userContent(context, learnerMessage) }],
      text: { format: zodTextFormat(tutorOutputSchema, "tutor_output") },
    });

    // A provider-side policy decline is an outcome, not an exception. The
    // Responses API reports it as a refusal item rather than an error.
    const refusal = findRefusal(response.output);
    if (refusal) {
      return { kind: "refusal", reason: `The provider declined this request (${refusal}).`, model };
    }

    // An incomplete response is truncated output, not a valid answer.
    if (response.status === "incomplete") {
      return {
        kind: "invalid",
        reason: `The tutor's response was cut short (${response.incomplete_details?.reason ?? "unspecified"}).`,
        model,
      };
    }

    if (response.output_parsed == null) {
      return { kind: "invalid", reason: "The tutor returned no structured output.", model };
    }
    return { kind: "output", parsed: response.output_parsed, model };
  } catch (error) {
    // Most specific first. Anything meaning "no usable model right now" becomes
    // unavailable so the caller can fall back deterministically.
    if (
      error instanceof OpenAI.AuthenticationError ||
      error instanceof OpenAI.RateLimitError ||
      error instanceof OpenAI.APIConnectionError ||
      (error instanceof OpenAI.APIError && (error.status ?? 500) >= 500)
    ) {
      return { kind: "unavailable", reason: `The model provider was unreachable (${error.constructor.name}).` };
    }
    if (error instanceof OpenAI.APIError) {
      return { kind: "invalid", reason: `The provider rejected the request (${error.status}).`, model };
    }
    throw error;
  }
}

async function runAnthropic(instruction: string, context: unknown, learnerMessage: string): Promise<ProviderResult> {
  const model = tutorModel();
  const client = new Anthropic();
  try {
    const message = await client.messages.parse({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: instruction,
      output_config: { format: zodOutputFormat(tutorOutputSchema) },
      messages: [{ role: "user", content: userContent(context, learnerMessage) }],
    });
    if (message.stop_reason === "refusal") {
      return {
        kind: "refusal",
        reason: `The provider declined this request (${message.stop_details?.category ?? "unspecified"}).`,
        model: message.model,
      };
    }
    return { kind: "output", parsed: message.parsed_output, model: message.model };
  } catch (error) {
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.RateLimitError ||
      error instanceof Anthropic.APIConnectionError ||
      (error instanceof Anthropic.APIError && (error.status ?? 500) >= 500)
    ) {
      return { kind: "unavailable", reason: `The model provider was unreachable (${error.constructor.name}).` };
    }
    if (error instanceof Anthropic.APIError) {
      return { kind: "invalid", reason: `The provider rejected the request (${error.status}).`, model };
    }
    throw error;
  }
}

export async function runTutorModel(input: {
  instruction: string;
  context: unknown;
  learnerMessage: string;
}): Promise<ProviderResult> {
  return tutorProvider() === "openai"
    ? runOpenAI(input.instruction, input.context, input.learnerMessage)
    : runAnthropic(input.instruction, input.context, input.learnerMessage);
}

export type { TutorOutput };
