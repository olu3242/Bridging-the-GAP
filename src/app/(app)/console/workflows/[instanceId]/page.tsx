import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import { getWorkflowTimeline, listWorkflowInstances } from "@/server/services/workflow-service";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Workflow run" };

/**
 * One run, end to end: what the runtime did (the orchestration stream) beside
 * what happened to the domain (the ledger). Two different truths, shown
 * together and never merged — the source column says which is which.
 */
export default async function WorkflowRunPage({
  params,
}: {
  params: Promise<{ instanceId: string }>;
}) {
  const [{ instanceId }, actor] = await Promise.all([params, requireActor()]);
  requireCapability(actor, "operator.console.view");

  const supabase = await createSupabaseServerClient();
  const [instances, timeline] = await Promise.all([
    listWorkflowInstances(supabase, { limit: 200 }),
    getWorkflowTimeline(supabase, instanceId),
  ]);
  const run = instances.find((i) => i.instance_id === instanceId);
  if (!run) notFound();

  const facts: Array<[string, string]> = [
    ["Status", run.instance_status],
    ["Current step", run.current_step ?? "—"],
    ["Owner", run.owner ?? "—"],
    ["Next step", run.next_step ?? "—"],
    ["Attempts", `${run.current_attempts ?? 0}/${run.current_max_attempts ?? 0}`],
    ["Deadline", run.deadline_at ? formatRelative(run.deadline_at) : "none"],
    ["Domain entity", run.subject_type ?? "—"],
    ["Last runtime event", run.last_event_at ? formatRelative(run.last_event_at) : "—"],
    ["Failure", run.instance_failure ?? run.current_failure ?? "none"],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{run.workflow_name}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Version {run.definition_version} · {run.waiting_on}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Where it is</CardTitle>
          <CardDescription>
            {run.steps_completed} of {run.steps_total} steps complete.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="mt-0.5 break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What happened</CardTitle>
          <CardDescription>
            Execution and evidence, in order. Neither drives the other.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nothing recorded yet"
              description="Events appear as the runtime and the engines act."
            />
          ) : (
            <ol className="space-y-2 text-sm">
              {timeline.map((row, index) => (
                <li
                  key={`${row.occurred_at}-${index}`}
                  className="flex flex-wrap items-baseline gap-2 border-b border-white/6 pb-2 last:border-0"
                >
                  <Badge tone={row.source === "orchestration" ? "neutral" : "brand"}>
                    {row.source}
                  </Badge>
                  <span className="font-medium text-ink">{row.event}</span>
                  {row.step_key ? (
                    <span className="text-xs text-ink-muted">{row.step_key}</span>
                  ) : null}
                  <span className="ml-auto text-xs text-ink-muted">
                    {row.emitted_by} · {formatRelative(row.occurred_at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
