"use client";
import { useActionState, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, Progress } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import { attemptProgress } from "@/domain/diagnostic/attempt";
import type { NextQuestionRow } from "@/lib/db/types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * One question at a time. No correct/incorrect feedback: grading happens
 * server-side against a table the learner cannot read, and showing the result
 * would turn an adaptive probe into a quiz that can be walked.
 */
export function BaselineQuestion({
  question,
  attemptId,
  action,
}: {
  question: NextQuestionRow;
  attemptId: string;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <Progress
        value={attemptProgress(question.asked_ordinal - 1, question.total_expected)}
        label={`Question ${question.asked_ordinal} of about ${question.total_expected}`}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{question.domain_name}</Badge>
            <Badge>{question.competency_name}</Badge>
          </div>
          <CardTitle className="mt-2 text-lg leading-snug">{question.prompt}</CardTitle>
          <CardDescription>
            Pick the best answer. You will not be told whether it was right — this is finding your
            level, not marking you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="attemptId" value={attemptId} />
            <input type="hidden" name="questionId" value={question.question_id} />

            {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}

            <fieldset className="space-y-2">
              <legend className="sr-only">{question.prompt}</legend>
              {question.options.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm transition-colors hover:bg-white/[0.06] has-[:checked]:border-brand/50 has-[:checked]:bg-brand/10"
                >
                  <input
                    type="radio"
                    name="option"
                    value={option.id}
                    required
                    checked={selected === option.id}
                    onChange={() => setSelected(option.id)}
                    className="mt-0.5 accent-[var(--color-brand)]"
                  />
                  <span className="text-ink">{option.label}</span>
                </label>
              ))}
            </fieldset>

            <SubmitButton className="w-full" pendingLabel="Recording…" disabled={!selected}>
              Continue
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
