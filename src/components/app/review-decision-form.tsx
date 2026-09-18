"use client";
import { useActionState, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import {
  CRITERION_MAX,
  CRITERION_MIN,
  CRITERION_PASS_SCORE,
  rubricSupportsApproval,
} from "@/domain/evidence/verification";
import type { RubricCriterionRow } from "@/lib/db/types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const SCORES = [CRITERION_MIN, 2, CRITERION_PASS_SCORE, CRITERION_MAX];

export function ReviewDecisionForm({
  reviewId,
  criteria,
  action,
}: {
  reviewId: string;
  criteria: RubricCriterionRow[];
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const [scores, setScores] = useState<Record<string, number | undefined>>({});
  const [decision, setDecision] = useState<"approved" | "rejected" | "revision_required">("approved");

  const support = rubricSupportsApproval(criteria, scores);
  const blocked = decision === "approved" && !support.ok;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your decision</CardTitle>
        <CardDescription>
          Score every criterion, then decide. Approval requires each required criterion at{" "}
          {CRITERION_PASS_SCORE} or better — the server enforces that too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5" noValidate>
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="decision" value={decision} />

          {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}

          <ul className="space-y-3">
            {criteria.map((criterion) => (
              <li key={criterion.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{criterion.label}</p>
                  {criterion.is_required ? <Badge tone="warning">Required</Badge> : <Badge>Stretch</Badge>}
                </div>
                <p className="mt-1 text-xs text-ink-subtle">{criterion.descriptor}</p>
                <fieldset className="mt-2 flex gap-2">
                  <legend className="sr-only">{criterion.label} score</legend>
                  {SCORES.map((score) => (
                    <label
                      key={score}
                      className="cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-xs text-ink-muted transition-colors has-[:checked]:border-brand/60 has-[:checked]:bg-brand/15 has-[:checked]:text-ink"
                    >
                      <input
                        type="radio"
                        name={`score:${criterion.id}`}
                        value={score}
                        className="sr-only"
                        onChange={() => setScores((prev) => ({ ...prev, [criterion.id]: score }))}
                      />
                      {score}
                    </label>
                  ))}
                </fieldset>
              </li>
            ))}
          </ul>

          <Field
            label="Rationale"
            htmlFor="rationale"
            hint="At least 10 characters. The learner sees this."
            error={state.fieldErrors?.rationale}
          >
            <Textarea id="rationale" name="rationale" required minLength={10} />
          </Field>

          {blocked ? <Alert tone="error">{support.reason}</Alert> : null}

          <div className="flex flex-wrap gap-2">
            <SubmitButton
              onClick={() => setDecision("approved")}
              disabled={blocked}
              pendingLabel="Recording…"
            >
              Approve
            </SubmitButton>
            <Button type="submit" variant="secondary" onClick={() => setDecision("revision_required")}>
              Ask for a revision
            </Button>
            <Button type="submit" variant="danger" onClick={() => setDecision("rejected")}>
              Reject
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
