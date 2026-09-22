"use client";
import { useActionState, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function EvidenceForm({
  projectId,
  expectedEvidence,
  action,
  isResubmission,
}: {
  projectId: string;
  expectedEvidence: string;
  action: Action;
  isResubmission: boolean;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const [aiDeclared, setAiDeclared] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isResubmission ? "Submit a revision" : "Submit your evidence"}</CardTitle>
        <CardDescription>
          {isResubmission
            ? "This becomes a new version. The previous one stays on record rather than being overwritten."
            : expectedEvidence}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="projectId" value={projectId} />
          {state.status === "error" && !state.fieldErrors ? (
            <Alert tone="error">{state.message}</Alert>
          ) : null}

          <Field
            label="What you produced"
            htmlFor="summary"
            hint="At least 40 characters. A reviewer reads this first."
            error={state.fieldErrors?.summary}
          >
            <Textarea id="summary" name="summary" required minLength={40} className="min-h-32" />
          </Field>

          <Field
            label="Link to the work"
            htmlFor="artifactUrl"
            hint="Optional — a repo, document or deployed page the reviewer can open."
            error={state.fieldErrors?.artifactUrl}
          >
            <Input id="artifactUrl" name="artifactUrl" type="url" placeholder="https://" />
          </Field>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <input
                type="checkbox"
                name="aiDeclared"
                checked={aiDeclared}
                onChange={(event) => setAiDeclared(event.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-brand)]"
              />
              <span>
                <span className="block text-sm text-ink">I used AI assistance on this work</span>
                <span className="block text-xs text-ink-subtle">
                  Declaring it is not a penalty. Not declaring it is an integrity problem.
                </span>
              </span>
            </label>
            {aiDeclared ? (
              <Field label="How you used it" htmlFor="aiNote" error={state.fieldErrors?.aiNote}>
                <Textarea id="aiNote" name="aiNote" required />
              </Field>
            ) : null}
          </div>

          <SubmitButton pendingLabel="Submitting…">
            {isResubmission ? "Submit revision" : "Submit for review"}
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
