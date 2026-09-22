"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { escalateOverdueWorkAction } from "@/server/actions/workflow";
import { idleState } from "@/server/actions/action-result";

/**
 * Runs the SLA sweep on demand. Human work is never queued — nothing polls a
 * person — so overdue work is found rather than dispatched, and until a
 * scheduler runs it the operator can.
 */
export function EscalateOverdueButton() {
  const [state, run, pending] = useActionState(escalateOverdueWorkAction, idleState);
  return (
    <div className="space-y-2">
      <form action={run}>
        <Button size="sm" variant="secondary" type="submit" disabled={pending}>
          {pending ? "Sweeping…" : "Escalate anything past its deadline"}
        </Button>
      </form>
      {state.status !== "idle" ? (
        <Alert tone={state.status === "success" ? "success" : "error"}>{state.message}</Alert>
      ) : null}
    </div>
  );
}
