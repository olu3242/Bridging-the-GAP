"use client";
import { useActionState } from "react";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState } from "@/server/actions/action-result";
import { publishReadyLessonsAction } from "@/server/actions/curriculum-release";

/**
 * Runs the governed bulk publication.
 *
 * Validation is not a separate button: the console page is the validation, and
 * it re-reads readiness on every load. This control does the one thing that
 * changes state, and it is safe to press repeatedly — the underlying function
 * is idempotent and skips lessons that are already published.
 */
export function PublishReadyLessons({ readyCount }: { readyCount: number }) {
  const [state, formAction] = useActionState(publishReadyLessonsAction, idleState);
  return (
    <form action={formAction} className="space-y-3">
      {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
      <p className="text-sm text-ink">
        {readyCount === 0
          ? "No lesson currently satisfies every gate. Running publication now will publish nothing and re-report the blockers below."
          : `${readyCount} lesson${readyCount === 1 ? "" : "s"} satisfy every gate and will be published in dependency order.`}
      </p>
      <SubmitButton pendingLabel="Publishing…">Publish ready lessons</SubmitButton>
    </form>
  );
}
