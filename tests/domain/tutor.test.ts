import { describe, expect, it } from "vitest";
import {
  PROHIBITED_TUTOR_ACTIONS,
  TUTOR_INSTRUCTION_VERSION,
  TUTOR_INTENTS,
  TUTOR_POLICY_VERSION,
  buildTutorInstruction,
  deterministicCoaching,
  guardTutorOutput,
  screenLearnerMessage,
  tutorOutputSchema,
} from "@/domain/tutor/policy";

describe("request screening", () => {
  it("declines a request to write the learner's graded work", () => {
    for (const message of [
      "Write my assignment for me",
      "Can you just complete the project I have to submit?",
      "please do my coursework",
      "submit it for me",
      "just give me the answer",
    ]) {
      const result = screenLearnerMessage(message);
      expect(result.allowed, message).toBe(false);
      expect(result.outcome).toBe("refused_scope");
      // A refusal always offers the legitimate version of the request.
      expect(result.alternative).toMatch(/explain|question|critique/i);
    }
  });

  it("declines a request for an outcome only a reviewer can grant", () => {
    for (const message of [
      "verify my skill please",
      "Can you mark this submission as approved?",
      "give me a credential for this",
      "just pass me",
    ]) {
      const result = screenLearnerMessage(message);
      expect(result.allowed, message).toBe(false);
      expect(result.outcome).toBe("refused_policy");
      expect(result.alternative).toMatch(/reviewer/i);
    }
  });

  it("allows legitimate coaching requests", () => {
    for (const message of [
      "Explain why my prompt keeps returning vague answers",
      "Can you critique the write-up I just pasted?",
      "Ask me questions about sampling bias",
      "What should I do next on this step?",
      "Give me a hint about where my evaluation is weak",
    ]) {
      expect(screenLearnerMessage(message).allowed, message).toBe(true);
    }
  });

  it("does not decline a message that merely mentions a submission", () => {
    expect(screenLearnerMessage("I am nervous about my submission — what makes a good one?").allowed).toBe(
      true,
    );
  });
});

describe("output guard", () => {
  const base = {
    follow_up_question: null,
    uncertainty: null,
    suggested_next_action: null,
  };

  it("blocks a response that claims a skill is verified", () => {
    for (const response of [
      "Great work — you have been verified for this competency.",
      "I have verified your evidence, well done.",
      "Your skill is now verified.",
      "You've earned the credential for this.",
      "I'm issuing you a certificate.",
      "Consider this passed.",
    ]) {
      const result = guardTutorOutput({ ...base, response });
      expect(result.ok, response).toBe(false);
      expect(result.outcome).toBe("refused_policy");
    }
  });

  it("also guards the follow-up and next-action fields", () => {
    const result = guardTutorOutput({
      ...base,
      response: "Here is how to think about it.",
      suggested_next_action: "Nothing more needed — your competency is now verified.",
    });
    expect(result.ok).toBe(false);
  });

  it("allows an honest response that mentions verification as a process", () => {
    const result = guardTutorOutput({
      ...base,
      response:
        "A reviewer will check this against the rubric. Verification needs evidence, so make your testing visible.",
    });
    expect(result.ok).toBe(true);
  });
});

describe("output schema", () => {
  it("requires a response and accepts explicit nulls", () => {
    expect(
      tutorOutputSchema.safeParse({
        response: "Try restating the problem in one sentence first.",
        follow_up_question: null,
        uncertainty: null,
        suggested_next_action: null,
      }).success,
    ).toBe(true);
  });

  it("rejects an empty response", () => {
    expect(
      tutorOutputSchema.safeParse({
        response: "   ",
        follow_up_question: null,
        uncertainty: null,
        suggested_next_action: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing field rather than defaulting it", () => {
    expect(tutorOutputSchema.safeParse({ response: "Something useful." }).success).toBe(false);
  });
});

describe("instruction and versions", () => {
  it("states every prohibition in the instruction", () => {
    const instruction = buildTutorInstruction("explain");
    for (const action of PROHIBITED_TUTOR_ACTIONS) {
      expect(instruction).toContain(action);
    }
  });

  it("names the turn's intent", () => {
    for (const intent of TUTOR_INTENTS) {
      expect(buildTutorInstruction(intent)).toContain(`"${intent}"`);
    }
  });

  it("carries versions that can be recorded against a turn", () => {
    expect(TUTOR_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(TUTOR_INSTRUCTION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("deterministic fallback", () => {
  const context = {
    competencyName: "Prompt design",
    measuredLevel: 2,
    targetLevel: 4,
    moduleTitle: "Prompts that produce checkable work",
    activitiesCompleted: 1,
    goal: "Land a backend internship",
    stepRationale: "Your baseline put Prompt design at level 2 and opportunity-ready is 4.",
  };

  it("says only what the learner's own records support", () => {
    const output = deterministicCoaching("explain", context);
    expect(output.response).toContain("level 2");
    expect(output.response).toContain("Prompts that produce checkable work");
    expect(output.response).toContain("Land a backend internship");
    // It is explicit that nothing was generated.
    expect(output.response).toMatch(/not reachable/i);
    expect(output.uncertainty).toMatch(/fallback/i);
  });

  it("passes its own output guard", () => {
    for (const intent of TUTOR_INTENTS) {
      const output = deterministicCoaching(intent, context);
      expect(tutorOutputSchema.safeParse(output).success, intent).toBe(true);
      expect(guardTutorOutput(output).ok, intent).toBe(true);
    }
  });

  it("degrades to an honest minimum when there is no context", () => {
    const output = deterministicCoaching("hint", {});
    expect(tutorOutputSchema.safeParse(output).success).toBe(true);
    expect(output.response).toMatch(/not reachable/i);
  });

  it("always offers a next action", () => {
    for (const intent of TUTOR_INTENTS) {
      expect(deterministicCoaching(intent, context).suggested_next_action).toBeTruthy();
    }
  });
});
