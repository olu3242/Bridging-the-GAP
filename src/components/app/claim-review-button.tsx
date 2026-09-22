"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function ClaimReviewButton({
  reviewId,
  claimed,
  isMine,
  action,
}: {
  reviewId: string;
  claimed: boolean;
  isMine: boolean;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);

  if (claimed) {
    return isMine ? (
      <Button asChild size="sm">
        <Link href={`/review/${reviewId}`}>Continue your review</Link>
      </Button>
    ) : (
      <p className="text-xs text-ink-subtle">Claimed by another reviewer.</p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
      <SubmitButton size="sm" pendingLabel="Claiming…">
        Claim and review
      </SubmitButton>
    </form>
  );
}
