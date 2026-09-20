"use client";
import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** An offer is answered by the applicant and nobody else. */
export function OfferResponse({
  applicationId,
  action,
}: {
  applicationId: string;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="accept" value="yes" />
          <SubmitButton size="sm" pendingLabel="Accepting…">
            <Check className="size-4" aria-hidden /> Accept offer
          </SubmitButton>
        </form>
        <form action={formAction}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="accept" value="no" />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Declining…">
            <X className="size-4" aria-hidden /> Decline
          </SubmitButton>
        </form>
      </div>
      {state.status === "success" ? (
        <p className="text-xs text-ink-subtle">{state.message}</p>
      ) : state.status === "error" ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}
    </div>
  );
}
