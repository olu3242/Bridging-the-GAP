"use client";
import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** Shown when an attempt's probe finished but scoring was interrupted. */
export function BaselineFinish({
  attemptId,
  answeredCount,
  action,
}: {
  attemptId: string;
  answeredCount: number;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardContent className="space-y-4 p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-white/6 text-success">
            <CheckCircle2 className="size-5" aria-hidden />
          </span>
          <CardTitle>That&apos;s every question</CardTitle>
          <CardDescription>
            You answered {answeredCount}. Submit to see where you stand.
          </CardDescription>
          {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
          <form action={formAction}>
            <input type="hidden" name="attemptId" value={attemptId} />
            <SubmitButton pendingLabel="Scoring…">See my results</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
