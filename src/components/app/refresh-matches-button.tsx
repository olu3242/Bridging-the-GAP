"use client";
import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState) => Promise<ActionState>;

export function RefreshMatchesButton({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, idleState);
  return (
    <div className="space-y-2">
      <form action={formAction}>
        <SubmitButton variant="secondary" size="sm" pendingLabel="Scoring…">
          <RefreshCw className="size-4" aria-hidden /> Refresh matches
        </SubmitButton>
      </form>
      {state.status === "success" ? (
        <p className="text-xs text-ink-subtle">{state.message}</p>
      ) : state.status === "error" ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}
    </div>
  );
}
