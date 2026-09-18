"use client";
import { useActionState } from "react";
import { AlertTriangle, Bot, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import { TUTOR_INTENTS, TUTOR_INTENT_COPY, type TutorIntent } from "@/domain/tutor/policy";
import type { TutorTurnRow } from "@/lib/db/types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const OUTCOME_COPY: Record<TutorTurnRow["outcome"], { label: string; tone: "neutral" | "warning" }> = {
  delivered: { label: "Answered", tone: "neutral" },
  refused_scope: { label: "Declined — out of scope", tone: "warning" },
  refused_policy: { label: "Declined — policy", tone: "warning" },
  provider_unavailable: { label: "Model unavailable — from your records", tone: "warning" },
  invalid_output: { label: "Response rejected", tone: "warning" },
};

export function TutorPanel({
  sessionId,
  turns,
  competencyName,
  providerConfigured,
  action,
}: {
  sessionId: string;
  turns: TutorTurnRow[];
  competencyName: string | null;
  providerConfigured: boolean;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <div className="space-y-4">
      <Alert tone="info" title="What this tutor will and will not do">
        It explains, questions, hints, critiques and recommends a next step. It will not write your
        submission, verify a skill or issue a credential — a human reviewer does that from your
        evidence. Every turn, including a refusal, is recorded.
      </Alert>

      {!providerConfigured ? (
        <Alert tone="error" title="No model is configured in this environment">
          The tutor will answer from your own persisted records instead of generating a reply. That
          fallback is honest but limited — it cannot respond to the specifics of your question.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-accent" aria-hidden /> AI tutor
            {competencyName ? <Badge tone="brand">{competencyName}</Badge> : null}
          </CardTitle>
          <CardDescription>
            It can see your measured level, this pathway step and your progress — nothing else.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {turns.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="Nothing asked yet"
              description="Pick what you want and ask. The tutor answers from your pathway context."
            />
          ) : (
            <ul className="space-y-4">
              {turns.map((turn) => {
                const outcome = OUTCOME_COPY[turn.outcome];
                return (
                  <li key={turn.id} className="space-y-2">
                    <div className="rounded-xl border border-white/8 bg-white/[0.05] px-4 py-3">
                      <p className="text-xs text-ink-subtle">
                        You · {TUTOR_INTENT_COPY[turn.intent as TutorIntent]}
                      </p>
                      <p className="mt-1 text-sm text-ink">{turn.learner_message}</p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-ink-subtle">Tutor</p>
                        <Badge tone={outcome.tone}>{outcome.label}</Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">
                        {turn.tutor_response}
                      </p>
                      {turn.refusal_reason ? (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                          {turn.refusal_reason}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <form action={formAction} className="space-y-3 border-t border-white/8 pt-4">
            <input type="hidden" name="sessionId" value={sessionId} />
            {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}

            <Field label="What do you want" htmlFor="intent">
              <Select id="intent" name="intent" defaultValue="explain">
                {TUTOR_INTENTS.map((intent) => (
                  <option key={intent} value={intent}>
                    {TUTOR_INTENT_COPY[intent]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Your message"
              htmlFor="message"
              hint="Paste your own work if you want it critiqued."
              error={state.fieldErrors?.message}
            >
              <Textarea id="message" name="message" required />
            </Field>

            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
                <ShieldCheck className="size-3.5" aria-hidden /> Recorded with the policy version that
                applied.
              </p>
              <SubmitButton size="sm" pendingLabel="Asking…">
                Ask the tutor
              </SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
