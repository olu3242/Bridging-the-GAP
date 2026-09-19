import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { WorkItemActions } from "./work-item-actions";
import { formatRelative } from "@/lib/utils";
import type { WorkQueueRow } from "@/server/services/workflow-service";

/**
 * One panel for every persona queue. The rows come from `my_work_queue`, which
 * the database scopes: a caller sees the work their persona owns, never work on
 * their own run, and the same rule decides whether a claim would be allowed.
 *
 * Deliberately not a separate Workflow OS surface — it goes inside the
 * dashboard the persona already uses, next to the engine screen where the real
 * decision is made.
 */
export function WorkQueuePanel({
  rows,
  title,
  description,
  emptyTitle,
  emptyDescription,
  actionHref,
  actionLabel,
}: {
  rows: WorkQueueRow[];
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Where the real decision is made; `:id` is replaced with the subject id. */
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title={emptyTitle} description={emptyDescription} />
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.work_item_id}
                className="rounded-xl border border-white/8 bg-white/[0.03] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{row.workflow_name}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Step {row.step_ordinal} · {row.step_key.replace(/_/g, " ")}
                      {row.deadline_at ? ` · due ${formatRelative(row.deadline_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.overdue ? <Badge tone="warning">Past deadline</Badge> : null}
                    {row.status === "escalated" ? <Badge tone="brand">Escalated</Badge> : null}
                    {row.mine ? <Badge tone="success">Yours</Badge> : null}
                  </div>
                </div>

                <WorkItemActions
                  workItemId={row.work_item_id}
                  mine={row.mine}
                  claimable={row.status === "ready" || row.status === "escalated"}
                  href={
                    actionHref && row.subject_id
                      ? actionHref.replace(":id", row.subject_id)
                      : undefined
                  }
                  label={actionLabel}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
