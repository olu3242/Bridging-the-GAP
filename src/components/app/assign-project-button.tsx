"use client";
import { useActionState } from "react";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function AssignProjectButton({
  briefSlug,
  stepId,
  action,
}: {
  briefSlug: string;
  stepId: string;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="briefSlug" value={briefSlug} />
      <input type="hidden" name="stepId" value={stepId} />
      {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
      <SubmitButton size="sm" variant="secondary" pendingLabel="Starting…">
        Take this on
      </SubmitButton>
    </form>
  );
}
