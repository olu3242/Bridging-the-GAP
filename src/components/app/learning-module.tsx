"use client";
import { useActionState, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Alert, Badge, Progress } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import type { LearnerModuleRow, LearningActivityRow } from "@/lib/db/types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function LearningModule({
  module: enrolment,
  activities,
  completedIds,
  stepId,
  action,
}: {
  module: LearnerModuleRow;
  activities: LearningActivityRow[];
  completedIds: string[];
  stepId: string;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const done = new Set(completedIds);
  const firstOpen = activities.find((a) => !done.has(a.id))?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(firstOpen);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{enrolment.module_title}</CardTitle>
          <Badge tone={enrolment.status === "completed" ? "success" : "neutral"}>
            {enrolment.activities_completed}/{enrolment.activities_total}
          </Badge>
        </div>
        {enrolment.summary ? <CardDescription>{enrolment.summary}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress
          value={
            enrolment.activities_total === 0
              ? 100
              : Math.round((enrolment.activities_completed / enrolment.activities_total) * 100)
          }
          label={`${enrolment.estimated_minutes} min · ${enrolment.competency_name}`}
        />
        {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}

        <ul className="space-y-2">
          {activities.map((activity) => {
            const isDone = done.has(activity.id);
            const isOpen = openId === activity.id;
            return (
              <li key={activity.id} className="rounded-xl border border-white/8 bg-white/[0.03]">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : activity.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-full ${
                      isDone ? "bg-success/20 text-success" : "bg-white/8 text-ink-subtle"
                    }`}
                  >
                    {isDone ? <Check className="size-3" aria-hidden /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{activity.title}</span>
                    <span className="block text-xs capitalize text-ink-subtle">
                      {activity.kind} · {activity.estimated_minutes} min
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-ink-subtle transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>

                {isOpen ? (
                  <div className="space-y-3 border-t border-white/8 px-4 py-3">
                    <p className="text-sm leading-relaxed text-ink-muted">{activity.body}</p>
                    {isDone ? (
                      <p className="text-xs text-success">Completed.</p>
                    ) : (
                      <form action={formAction} className="space-y-3">
                        <input type="hidden" name="activityId" value={activity.id} />
                        <input type="hidden" name="stepId" value={stepId} />
                        {activity.requires_output ? (
                          <Field
                            label="Your work"
                            htmlFor={`output-${activity.id}`}
                            hint="Kept on record and attachable to a project submission later."
                            error={state.fieldErrors?.output}
                          >
                            <Textarea id={`output-${activity.id}`} name="output" required />
                          </Field>
                        ) : null}
                        <SubmitButton size="sm" pendingLabel="Saving…">
                          Mark complete
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
