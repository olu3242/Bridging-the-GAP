"use client";
import { useActionState } from "react";
import { Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import type { MentorRecommendationRow, MentorshipRow } from "@/lib/db/types";
import { formatRelative } from "@/lib/utils";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function MentorRecommendations({
  recommendations,
  action,
}: {
  recommendations: MentorRecommendationRow[];
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recommended mentors</CardTitle>
        <CardDescription>
          Ranked by how much of your open pathway their expertise covers. The reason is shown, not a
          score.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
        {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}

        {recommendations.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No mentors to suggest yet"
            description="Recommendations come from the competencies your pathway has opened. Open a step and check back."
          />
        ) : (
          recommendations.map((mentor) => (
            <div
              key={mentor.mentor_profile_id}
              className="rounded-xl border border-white/8 bg-white/[0.03] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">{mentor.mentor_name}</p>
                <Badge tone="brand">
                  {mentor.covered_count}/{mentor.open_step_count} steps covered
                </Badge>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{mentor.headline}</p>
              <p className="mt-2 text-xs text-ink-subtle">{mentor.rationale}</p>
              <form action={formAction} className="mt-3 space-y-3">
                <input type="hidden" name="mentorProfileId" value={mentor.mentor_profile_id} />
                <Field
                  label="What you need help with"
                  htmlFor={`message-${mentor.mentor_profile_id}`}
                  hint="Optional, but it helps them decide."
                >
                  <Textarea id={`message-${mentor.mentor_profile_id}`} name="message" />
                </Field>
                <SubmitButton size="sm" pendingLabel="Sending…">
                  Ask to be mentored
                </SubmitButton>
              </form>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function MentorshipRequests({
  mentorships,
  isMentorView,
  action,
}: {
  mentorships: MentorshipRow[];
  isMentorView: boolean;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isMentorView ? "Requests for you" : "Your mentorships"}</CardTitle>
        <CardDescription>
          {isMentorView
            ? "Each request says which of the learner's open steps you cover."
            : "A mentor decides whether to take a request on."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
        {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}

        {mentorships.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nothing here yet"
            description={
              isMentorView
                ? "Requests appear here when a learner asks for your help."
                : "Ask a recommended mentor and it will show up here."
            }
          />
        ) : (
          mentorships.map((mentorship) => (
            <div key={mentorship.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink">
                  {(mentorship.rationale.covered_competencies ?? []).join(", ") || "Mentorship"}
                </p>
                <Badge
                  tone={
                    mentorship.status === "accepted" || mentorship.status === "active"
                      ? "success"
                      : mentorship.status === "declined"
                        ? "neutral"
                        : "warning"
                  }
                >
                  {mentorship.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-ink-subtle">
                Requested {formatRelative(mentorship.requested_at)}
              </p>
              {mentorship.learner_message ? (
                <p className="mt-2 text-sm text-ink-muted">{mentorship.learner_message}</p>
              ) : null}
              {mentorship.mentor_response ? (
                <p className="mt-2 text-sm text-ink-muted">
                  <span className="text-ink-subtle">Mentor: </span>
                  {mentorship.mentor_response}
                </p>
              ) : null}

              {isMentorView && mentorship.status === "requested" ? (
                <form action={formAction} className="mt-3 space-y-3">
                  <input type="hidden" name="mentorshipId" value={mentorship.id} />
                  <Field label="Your reply" htmlFor={`response-${mentorship.id}`}>
                    <Textarea id={`response-${mentorship.id}`} name="response" />
                  </Field>
                  <div className="flex gap-2">
                    <SubmitButton size="sm" name="accept" value="true" pendingLabel="Saving…">
                      Accept
                    </SubmitButton>
                    <SubmitButton size="sm" variant="secondary" name="accept" value="false">
                      Decline
                    </SubmitButton>
                  </div>
                </form>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
