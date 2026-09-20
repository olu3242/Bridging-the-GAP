import { Route } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState, Progress } from "@/components/ui/feedback";
import type {
  WorkflowInstanceRow,
  WorkflowStateRow,
} from "@/server/services/workflow-service";

/** Plain names for the coordinator's stages; the keys come from the database. */
const STAGE_LABELS: Record<string, string> = {
  signed_up: "Joined",
  onboarded: "Onboarding",
  baseline_measured: "Baseline measured",
  pathway_generated: "Pathway built",
  learning_started: "Learning",
  project_assigned: "Project",
  evidence_submitted: "Evidence sent",
  skill_verified: "Skill verified",
  credential_issued: "Credential",
  mentorship_matched: "Mentor",
  matches_computed: "Matches",
  applied: "Applied",
  decision_received: "Decision",
  outcome_recorded: "Offer accepted",
};

/**
 * Where the learner is, from their own coordinator run. Nothing here is a
 * separate source of truth: the stages are the pinned definition's steps and
 * each one completed only because an engine recorded the underlying fact.
 */
export function JourneyPanel({
  instance,
  stages,
}: {
  instance: WorkflowInstanceRow | null;
  stages: WorkflowStateRow[];
}) {
  if (!instance) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your journey</CardTitle>
          <CardDescription>From joining to an accepted offer.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Route}
            title="Not started yet"
            description="Finish onboarding and your journey appears here, stage by stage."
          />
        </CardContent>
      </Card>
    );
  }

  const total = stages.length || instance.steps_total;
  const done = stages.filter((s) => s.work_item_status === "completed").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Route className="size-4 text-accent" aria-hidden />
          Your journey
        </CardTitle>
        <CardDescription>
          {instance.instance_status === "completed"
            ? "Every stage is behind you."
            : instance.waiting_on}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress
          value={total === 0 ? 0 : Math.round((done / total) * 100)}
          label={`${done} of ${total} stages`}
        />
        <ol className="space-y-2 text-sm">
          {stages.map((stage) => {
            const label = STAGE_LABELS[stage.step_key ?? ""] ?? stage.step_key;
            const isCurrent =
              stage.work_item_status === "ready" ||
              stage.work_item_status === "claimed" ||
              stage.work_item_status === "escalated";
            return (
              <li
                key={stage.work_item_id ?? stage.step_key}
                className="flex flex-wrap items-center gap-2"
              >
                <span
                  className={
                    stage.work_item_status === "completed"
                      ? "text-ink"
                      : isCurrent
                        ? "font-medium text-ink"
                        : "text-ink-muted"
                  }
                >
                  {label}
                </span>
                {stage.work_item_status === "completed" ? (
                  <Badge tone="success">done</Badge>
                ) : stage.work_item_status === "cancelled" ? (
                  <Badge>skipped</Badge>
                ) : isCurrent ? (
                  <Badge tone="brand">now</Badge>
                ) : null}
                {isCurrent && stage.deadline_at ? (
                  <span className="text-xs text-ink-muted">has a deadline</span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {instance.instance_failure ? (
          <p className="text-xs text-danger">{instance.instance_failure}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
