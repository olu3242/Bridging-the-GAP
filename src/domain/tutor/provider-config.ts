/**
 * Which model provider the tutor runs on, decided from configuration alone.
 *
 * Pure and environment-injected so it can be tested without a server context.
 * It resolves names and credential *presence* only — it never reads, returns or
 * logs a key's value, and nothing here is reachable from the browser.
 */

export type TutorProviderName = "openai" | "anthropic";

export const DEFAULT_TUTOR_MODEL: Readonly<Record<TutorProviderName, string>> = {
  openai: "gpt-5",
  anthropic: "claude-opus-5",
};

export interface TutorEnv {
  BTG_AI_PROVIDER?: string;
  BTG_TUTOR_MODEL?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

/**
 * OpenAI is the default. An unrecognised value resolves to the default rather
 * than throwing: a typo in an environment variable should degrade the tutor to
 * its configured provider, not take down every page that renders it.
 */
export function resolveTutorProvider(env: TutorEnv): TutorProviderName {
  return env.BTG_AI_PROVIDER?.trim().toLowerCase() === "anthropic" ? "anthropic" : "openai";
}

export function resolveTutorModel(env: TutorEnv): string {
  const configured = env.BTG_TUTOR_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_TUTOR_MODEL[resolveTutorProvider(env)];
}

/** Whether a credential exists for the configured provider. Presence only. */
export function hasTutorCredential(env: TutorEnv): boolean {
  const present = (value: string | undefined) => typeof value === "string" && value.trim().length > 0;
  return resolveTutorProvider(env) === "openai"
    ? present(env.OPENAI_API_KEY)
    : present(env.ANTHROPIC_API_KEY) || present(env.ANTHROPIC_AUTH_TOKEN);
}
