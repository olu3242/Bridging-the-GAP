"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import {
  claimWorkItemAction,
  completeWorkItemAction,
  releaseWorkItemAction,
} from "@/server/actions/workflow";
import { idleState } from "@/server/actions/action-result";

/**
 * Claim, hand back, or tell the runtime the decision is made. "Mark done" does
 * not decide anything: the database refuses it unless the engine already
 * records the outcome, so the failure message is the honest one — the work is
 * not finished yet.
 */
export function WorkItemActions({
  workItemId,
  mine,
  claimable,
  href,
  label,
}: {
  workItemId: string;
  mine: boolean;
  claimable: boolean;
  href?: string;
  label?: string;
}) {
  const [claimState, claim, claiming] = useActionState(claimWorkItemAction, idleState);
  const [releaseState, release, releasing] = useActionState(releaseWorkItemAction, idleState);
  const [completeState, complete, completing] = useActionState(completeWorkItemAction, idleState);
  const state = [completeState, releaseState, claimState].find((s) => s.status !== "idle");

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {href ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={href}>{label ?? "Open"}</Link>
          </Button>
        ) : null}

        {!mine && claimable ? (
          <form action={claim}>
            <input type="hidden" name="workItemId" value={workItemId} />
            <Button size="sm" type="submit" disabled={claiming}>
              {claiming ? "Taking…" : "Take this"}
            </Button>
          </form>
        ) : null}

        {mine ? (
          <>
            <form action={complete}>
              <input type="hidden" name="workItemId" value={workItemId} />
              <Button size="sm" type="submit" disabled={completing}>
                {completing ? "Checking…" : "Mark done"}
              </Button>
            </form>
            <form action={release}>
              <input type="hidden" name="workItemId" value={workItemId} />
              <Button size="sm" type="submit" variant="ghost" disabled={releasing}>
                Hand back
              </Button>
            </form>
          </>
        ) : null}
      </div>

      {state && state.status !== "idle" ? (
        <Alert tone={state.status === "success" ? "success" : "error"}>{state.message}</Alert>
      ) : null}
    </div>
  );
}
