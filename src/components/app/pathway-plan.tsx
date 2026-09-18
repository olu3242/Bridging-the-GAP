"use client";
import { useActionState } from "react";
import { ArrowRight, CheckCircle2, CircleDot, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, Progress } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import { STEP_STATUS_COPY, nextStep, pathwayProgress } from "@/domain/pathway/pathway";
import { LEVEL_LABELS, type CompetencyLevel } from "@/domain/competency/levels";
import type { PathwayRow, PathwayStepViewRow } from "@/lib/db/types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const ICONS = {
  completed: CheckCircle2,
  in_progress: CircleDot,
  available: CircleDot,
  locked: Lock,
  skipped: CheckCircle2,
} as const;

export function PathwayPlan({
  pathway,
  steps,
  startAction,
  generated,
}: {
  pathway: PathwayRow;
  steps: PathwayStepViewRow[];
  startAction: Action;
  generated: boolean;
}) {
  const [state, formAction] = useActionState(startAction, idleState);
  const next = nextStep(steps);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your pathway</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Version {pathway.version}, built from your baseline and ordered so nothing arrives before
          its prerequisites.
        </p>
      </div>

      {generated ? (
        <Alert tone="success" title="Pathway ready">
          {pathway.rationale.steps === 0
            ? "Your baseline is already at target across the board, so there is nothing to close yet."
            : `${pathway.rationale.steps} steps, ordered by ${pathway.rationale.ordering}.`}
        </Alert>
      ) : null}
      {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}

      {steps.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <CardTitle>Nothing to close right now</CardTitle>
            <CardDescription className="mt-1">
              Every competency your baseline measured is at or above its target level. Re-run the
              baseline after building something and the plan will reflect the change.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <>
          <Progress value={pathwayProgress(steps)} label="Pathway progress" />

          <ol className="space-y-3">
            {steps.map((step) => {
              const Icon = ICONS[step.status];
              const isNext = next?.id === step.id;
              return (
                <li key={step.id}>
                  <Card className={isNext ? "ring-1 ring-brand/40" : undefined}>
                    <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <span
                          className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${
                            step.status === "completed"
                              ? "bg-success/15 text-success"
                              : step.status === "locked"
                                ? "bg-white/5 text-ink-subtle"
                                : "bg-brand/15 text-brand"
                          }`}
                        >
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-ink-subtle">
                              {String(step.position).padStart(2, "0")}
                            </span>
                            <p className="text-sm font-medium text-ink">{step.competency_name}</p>
                            <Badge tone={step.status === "completed" ? "success" : "neutral"}>
                              {STEP_STATUS_COPY[step.status]}
                            </Badge>
                          </div>
                          <p className="text-xs text-ink-subtle">{step.rationale}</p>
                          <p className="text-xs text-ink-subtle">
                            {LEVEL_LABELS[step.from_level as CompetencyLevel]} →{" "}
                            {LEVEL_LABELS[step.target_level as CompetencyLevel]} · {step.domain_name}
                          </p>
                          {step.blocked_by.length > 0 ? (
                            <p className="text-xs text-warning">
                              Blocked by {step.blocked_by.join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {step.status === "available" || step.status === "in_progress" ? (
                        <form action={formAction} className="shrink-0">
                          <input type="hidden" name="stepId" value={step.id} />
                          <SubmitButton size="sm" pendingLabel="Opening…">
                            {step.status === "in_progress" ? "Continue" : "Start"}
                            <ArrowRight className="size-4" aria-hidden />
                          </SubmitButton>
                        </form>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
