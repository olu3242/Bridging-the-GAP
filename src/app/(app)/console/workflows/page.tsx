import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { EscalateOverdueButton } from "@/components/app/escalate-overdue-button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import {
  listWorkflowBlockers,
  listWorkflowInstances,
} from "@/server/services/workflow-service";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Workflow runs" };

const BLOCKER_LABELS: Record<string, string> = {
  run_failed: "Run failed",
  step_failed: "Step failed",
  escalated: "Escalated",
  past_deadline: "Past deadline",
  retrying: "Retrying",
  deadline_close: "Deadline close",
  awaiting_person: "Waiting on a person",
  stalled: "No activity for a day",
  other: "Needs a look",
};

/**
 * The operator's view of execution state. Reads projections only — every row
 * here comes from workflow_blockers_view or workflow_instance_view, and the
 * levers (reassign, escalate) are the same governed commands anybody else
 * would have to go through. Seeing a run never implies authority over it.
 */
export default async function WorkflowConsolePage() {
  const actor = await requireActor();
  requireCapability(actor, "operator.console.view");

  const supabase = await createSupabaseServerClient();
  const [blockers, open] = await Promise.all([
    listWorkflowBlockers(supabase, 50),
    listWorkflowInstances(supabase, { open: true, limit: 50 }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Workflow runs</h1>
        <p className="mt-1 text-sm text-ink-muted">
          What is running, what is waiting and why. These are projections — the engines stay
          authoritative, and every action here goes through the same commands as everyone else&apos;s.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>Most serious first. A healthy run does not appear here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <EscalateOverdueButton />
          {blockers.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="Nothing is blocked"
              description="No run has failed, passed a deadline or stalled."
            />
          ) : (
            <ul className="space-y-3">
              {blockers.map((row) => (
                <li
                  key={row.instance_id}
                  className="rounded-xl border border-white/8 bg-white/[0.03] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {row.workflow_name}
                        <span className="text-ink-muted"> · v{row.definition_version}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">{row.waiting_on}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={row.severity <= 2 ? "warning" : "neutral"}>
                        {BLOCKER_LABELS[row.blocker] ?? row.blocker}
                      </Badge>
                      {row.owner ? <Badge>{row.owner}</Badge> : null}
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-muted sm:grid-cols-4">
                    <div>
                      <dt>Step</dt>
                      <dd className="text-ink">
                        {row.current_step ?? "—"}
                        {row.steps_total ? ` (${row.steps_completed}/${row.steps_total})` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Attempts</dt>
                      <dd className="text-ink">
                        {row.current_attempts ?? 0}/{row.current_max_attempts ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt>Deadline</dt>
                      <dd className="text-ink">
                        {row.deadline_at ? formatRelative(row.deadline_at) : "none"}
                      </dd>
                    </div>
                    <div>
                      <dt>Entity</dt>
                      <dd className="text-ink">{row.subject_type ?? "—"}</dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <Link
                      href={`/console/workflows/${row.instance_id}`}
                      className="text-xs text-accent underline-offset-4 hover:underline"
                    >
                      Open the timeline
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open runs</CardTitle>
          <CardDescription>Everything currently in flight.</CardDescription>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Nothing in flight"
              description="Runs appear here as learners and organizations act."
            />
          ) : (
            <ul className="divide-y divide-white/8 text-sm">
              {open.map((row) => (
                <li key={row.instance_id} className="flex flex-wrap items-center gap-3 py-3">
                  <Link
                    href={`/console/workflows/${row.instance_id}`}
                    className="min-w-0 flex-1 truncate font-medium text-ink hover:underline"
                  >
                    {row.workflow_name}
                  </Link>
                  <span className="text-xs text-ink-muted">
                    {row.steps_completed}/{row.steps_total} · {row.waiting_on}
                  </span>
                  <Badge tone={row.overdue ? "warning" : "neutral"}>{row.instance_status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
