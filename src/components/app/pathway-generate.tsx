"use client";
import { useActionState } from "react";
import { Route } from "lucide-react";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState) => Promise<ActionState>;

export function PathwayGenerate({ action, gapCount }: { action: Action; gapCount: number }) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardContent className="space-y-4 p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-white/6 text-accent">
            <Route className="size-5" aria-hidden />
          </span>
          <CardTitle>Build your pathway</CardTitle>
          <CardDescription>
            {gapCount > 0
              ? `Your baseline found ${gapCount} competencies below target. The plan orders them so nothing arrives before its prerequisites, and each step says why it is there.`
              : "Your baseline is at target across the board. Generating a plan will record that rather than inventing work."}
          </CardDescription>
          {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
          <form action={formAction}>
            <SubmitButton pendingLabel="Building…">Generate my pathway</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
