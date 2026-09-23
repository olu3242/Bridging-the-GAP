import { z } from "zod";

/**
 * E7 — the tutor's governance contract.
 *
 * Bumped whenever the rules change, and recorded on every turn so a past turn
 * can be judged against the policy that actually applied to it.
 */
export const TUTOR_POLICY_VERSION = "2026-09-22.1";
export const TUTOR_INSTRUCTION_VERSION = "2026-09-22.1";

export const TUTOR_INTENTS = ["explain", "question", "hint", "critique", "recommend_next"] as const;
export type TutorIntent = (typeof TUTOR_INTENTS)[number];

export const TUTOR_OUTCOMES = [
  "delivered",
  "refused_policy",
  "refused_scope",
  "provider_unavailable",
  "invalid_output",
] as const;
export type TutorOutcome = (typeof TUTOR_OUTCOMES)[number];

export const TUTOR_INTENT_COPY: Record<TutorIntent, string> = {
  explain: "Explain this to me",
  question: "Ask me questions about it",
  hint: "Give me a hint",
  critique: "Critique what I wrote",
  recommend_next: "What should I do next?",
};

/**
 * What the tutor may never do. These are enforced twice: the request is
 * screened before the model sees it, and the response is screened before the
 * learner sees it. The database enforces the rest structurally — the tutor has
 * no write path to evidence, verification, credentials or competency level.
 */
export const PROHIBITED_TUTOR_ACTIONS = [
  "submit graded work on a learner's behalf",
  "fabricate an assessment result or score",
  "mark a skill verified",
  "issue or promise a credential",
  "bypass human review",
  "alter a learner's recorded evidence",
] as const;

/** Requests that ask the tutor to produce the learner's graded submission. */
const DO_IT_FOR_ME = [
  /\b(write|do|complete|finish|produce)\b[^.?!]{0,40}\b(my|the)\b[^.?!]{0,30}\b(assignment|submission|project|evidence|homework|coursework|essay)\b/i,
  /\bsubmit\b[^.?!]{0,30}\b(for me|on my behalf)\b/i,
  /\bjust give me the (answer|solution|code)\b/i,
  /\banswer key\b/i,
];

/** Requests that ask the tutor to hand out an outcome it cannot grant. */
const CLAIM_AN_OUTCOME = [
  /\b(verify|mark|approve)\b[^.?!]{0,30}\b(my|this)\b[^.?!]{0,20}\b(skill|competency|evidence|submission)\b/i,
  /\b(give|issue|award)\b[^.?!]{0,25}\b(credential|certificate|badge)\b/i,
  /\bpass me\b/i,
];

export interface ScreenResult {
  allowed: boolean;
  outcome: Extract<TutorOutcome, "refused_scope" | "refused_policy"> | null;
  reason?: string;
  /** What the learner can do instead — a refusal always offers a next action. */
  alternative?: string;
}

/**
 * Screens the learner's message. A refusal is not a dead end: it names the
 * boundary and offers the legitimate version of the request.
 */
export function screenLearnerMessage(message: string): ScreenResult {
  const text = message.trim();

  if (DO_IT_FOR_ME.some((pattern) => pattern.test(text))) {
    return {
      allowed: false,
      outcome: "refused_scope",
      reason: "The learner asked the tutor to produce graded work.",
      alternative:
        "I won't write your submission — it has to be your work for the verification to mean anything. I can explain the part you're stuck on, question your approach, or critique a draft you've written.",
    };
  }

  if (CLAIM_AN_OUTCOME.some((pattern) => pattern.test(text))) {
    return {
      allowed: false,
      outcome: "refused_policy",
      reason: "The learner asked the tutor to grant an outcome only a reviewer can grant.",
      alternative:
        "I can't verify a skill or issue a credential — a human reviewer scores your evidence against the rubric. I can help you get the evidence ready for that review.",
    };
  }

  return { allowed: true, outcome: null };
}

/** The structured shape the model is required to return. */
export const tutorOutputSchema = z.object({
  /** The coaching response shown to the learner. */
  response: z
    .string()
    .trim()
    .min(1, "The tutor returned nothing.")
    .max(4000, "The tutor returned more than the transcript allows."),
  /** A question back to the learner, when the intent calls for one. */
  follow_up_question: z.string().trim().max(500).nullable(),
  /** What the tutor is unsure about. Empty is allowed; omitted is not. */
  uncertainty: z.string().trim().max(500).nullable(),
  /** The next concrete action the learner should take. */
  suggested_next_action: z.string().trim().max(500).nullable(),
});

export type TutorOutput = z.infer<typeof tutorOutputSchema>;

/** Phrases that would mean the tutor claimed an outcome it cannot grant. */
const OVERCLAIM_PATTERNS = [
  /\byou(?:'ve| have)? (?:now )?(?:been )?verified\b/i,
  /\bi(?:'ve| have)? (?:verified|approved|marked)\b[^.?!]{0,30}\b(skill|competency|evidence|submission)\b/i,
  /\byour (?:skill|competency) is (?:now )?verified\b/i,
  /\byou(?:'ve| have)? earned (?:the |a )?(?:credential|certificate|badge)\b/i,
  /\bi(?:'m| am) (?:issuing|awarding) you\b/i,
  /\bconsider (?:this|it) (?:graded|passed|verified)\b/i,
];

export interface GuardResult {
  ok: boolean;
  outcome: Extract<TutorOutcome, "refused_policy" | "invalid_output"> | null;
  reason?: string;
}

/**
 * Deterministic guard over the model's output. Runs after schema validation,
 * because a well-formed response can still claim something the tutor may not.
 */
export function guardTutorOutput(output: TutorOutput): GuardResult {
  const haystack = [output.response, output.follow_up_question, output.suggested_next_action]
    .filter(Boolean)
    .join("\n");

  const overclaim = OVERCLAIM_PATTERNS.find((pattern) => pattern.test(haystack));
  if (overclaim) {
    return {
      ok: false,
      outcome: "refused_policy",
      reason: `The tutor's response claimed an outcome it cannot grant (${overclaim.source.slice(0, 40)}).`,
    };
  }

  return { ok: true, outcome: null };
}

/** The instruction sent to the model. Versioned with the policy above. */
export function buildTutorInstruction(intent: TutorIntent): string {
  return [
    "You are the BTG AI tutor. You are coaching a learner through a competency on their personalized pathway. Learners may be anywhere in the world, so use globally understandable language, avoid assuming a country or education system, and localize examples when the learner's context is known.",
    "",
    "You may: explain, ask questions, give hints, critique work the learner has written, and recommend the next concrete step.",
    "",
    "You must never:",
    ...PROHIBITED_TUTOR_ACTIONS.map((action) => `- ${action}`),
    "",
    "If the learner asks you to produce their graded submission, decline and offer to explain, question or critique instead.",
    "Say plainly when you are unsure rather than guessing, and put that in the uncertainty field.",
    "Never claim a skill is verified or a credential earned — a human reviewer decides that from submitted evidence.",
    "",
    `This turn's intent is "${intent}". Keep the response under 300 words and concrete.`,
  ].join("\n");
}

/**
 * The deterministic coaching response used when no model is reachable. It is
 * assembled from the learner's own persisted state, so it says nothing the
 * database cannot support — no fabricated encouragement, no invented content.
 */
export function deterministicCoaching(
  intent: TutorIntent,
  context: {
    competencyName?: string;
    measuredLevel?: number | null;
    targetLevel?: number | null;
    moduleTitle?: string | null;
    activitiesCompleted?: number;
    goal?: string | null;
    stepRationale?: string | null;
  },
): TutorOutput {
  const competency = context.competencyName ?? "this competency";
  const facts: string[] = [];

  if (context.measuredLevel != null && context.targetLevel != null) {
    facts.push(
      `Your baseline put ${competency} at level ${context.measuredLevel}, and this step targets level ${context.targetLevel}.`,
    );
  }
  if (context.moduleTitle) {
    facts.push(
      `You are working through "${context.moduleTitle}" and have completed ${context.activitiesCompleted ?? 0} activities in it.`,
    );
  }
  if (context.goal) facts.push(`Your stated goal is: ${context.goal}.`);
  if (context.stepRationale) facts.push(context.stepRationale);

  const nextAction =
    intent === "recommend_next"
      ? "Open the next activity in this module and record what you actually tried — that becomes the evidence a reviewer reads."
      : "Work the next activity in this module, then come back and ask me to critique what you wrote.";

  return {
    response: [
      "The AI tutor is not reachable right now, so here is what your own record says, rather than a guess:",
      "",
      ...facts.map((fact) => `- ${fact}`),
      "",
      "Nothing above is generated — it comes from your baseline, your pathway step and your progress.",
    ].join("\n"),
    follow_up_question:
      intent === "question" ? `What part of ${competency} would you struggle to explain to a classmate?` : null,
    uncertainty: "This is a fallback response assembled from your records; no model reviewed your question.",
    suggested_next_action: nextAction,
  };
}
