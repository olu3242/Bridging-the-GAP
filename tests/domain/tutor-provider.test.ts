import { describe, expect, it } from "vitest";
import {
  DEFAULT_TUTOR_MODEL,
  hasTutorCredential,
  resolveTutorModel,
  resolveTutorProvider,
} from "@/domain/tutor/provider-config";

describe("tutor provider configuration", () => {
  it("defaults to OpenAI", () => {
    expect(resolveTutorProvider({})).toBe("openai");
    expect(resolveTutorProvider({ BTG_AI_PROVIDER: "openai" })).toBe("openai");
    expect(resolveTutorProvider({ BTG_AI_PROVIDER: "  OpenAI  " })).toBe("openai");
  });

  it("selects Anthropic only when explicitly configured", () => {
    expect(resolveTutorProvider({ BTG_AI_PROVIDER: "anthropic" })).toBe("anthropic");
    expect(resolveTutorProvider({ BTG_AI_PROVIDER: "ANTHROPIC" })).toBe("anthropic");
  });

  it("falls back to the default rather than throwing on a typo", () => {
    // A mistyped variable should degrade to the default provider, not take down
    // every page that renders the tutor.
    expect(resolveTutorProvider({ BTG_AI_PROVIDER: "opemai" })).toBe("openai");
    expect(resolveTutorProvider({ BTG_AI_PROVIDER: "" })).toBe("openai");
  });

  it("uses the configured model, or the provider's default", () => {
    expect(resolveTutorModel({})).toBe(DEFAULT_TUTOR_MODEL.openai);
    expect(resolveTutorModel({ BTG_AI_PROVIDER: "anthropic" })).toBe(DEFAULT_TUTOR_MODEL.anthropic);
    expect(resolveTutorModel({ BTG_TUTOR_MODEL: "gpt-5-mini" })).toBe("gpt-5-mini");
    // A blank value is not a model name.
    expect(resolveTutorModel({ BTG_TUTOR_MODEL: "   " })).toBe(DEFAULT_TUTOR_MODEL.openai);
  });

  it("detects the credential belonging to the selected provider only", () => {
    expect(hasTutorCredential({ OPENAI_API_KEY: "sk-test" })).toBe(true);
    // This is the misconfiguration that shipped: an OpenAI key present while the
    // code reads Anthropic's, or the reverse. Each provider sees only its own.
    expect(hasTutorCredential({ BTG_AI_PROVIDER: "anthropic", OPENAI_API_KEY: "sk-test" })).toBe(false);
    expect(hasTutorCredential({ BTG_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant" })).toBe(true);
    expect(hasTutorCredential({ BTG_AI_PROVIDER: "anthropic", ANTHROPIC_AUTH_TOKEN: "token" })).toBe(true);
    expect(hasTutorCredential({ ANTHROPIC_API_KEY: "sk-ant" })).toBe(false);
  });

  it("treats a blank credential as absent", () => {
    // A variable created-but-empty must not read as configured; that is the same
    // class of failure as the blank NEXT_PUBLIC_* values.
    expect(hasTutorCredential({ OPENAI_API_KEY: "" })).toBe(false);
    expect(hasTutorCredential({ OPENAI_API_KEY: "   " })).toBe(false);
  });
});
