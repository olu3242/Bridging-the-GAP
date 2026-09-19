import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { ClaimReviewButton } from "@/components/app/claim-review-button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import { getReviewQueue } from "@/server/services/review-service";
import { getMyWorkQueue } from "@/server/services/workflow-service";
import { WorkQueuePanel } from "@/components/app/work-queue-panel";
import { claimReviewAction } from "@/server/actions/review";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ decided?: string }>;
}) {
  const [{ decided }, actor] = await Promise.all([searchParams, requireActor()]);
  // A reviewer persona is required; the database checks it again on claim.
  assertCan(actor, "review.decide");

  const supabase = await createSupabaseServerClient();
  // Two queues, deliberately: the engine's review assignments, and the
  // workflow steps waiting on this reviewer with their deadlines and
  // escalations. The decision itself is still made on the review screen.
  const workQueue = await getMyWorkQueue(supabase, { workflow: "verification" });
  const queue = (await getReviewQueue(supabase)) as unknown as Array<{
    id: string;
    status: string;
    assigned_at: string;
    reviewer_profile_id: string | null;
    evidence: {
      id: string;
      version: number;
      summary: string;
      ai_assistance_declared: boolean;
      competencies: { name: string } | null;
    } | null;
  }>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Review queue</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Evidence waiting on a human decision. You cannot review your own work.
        </p>
      </div>

      {decided === "1" ? (
        <Alert tone="success" title="Decision recorded">
          The learner has been notified, and the outcome is on the audit trail.
        </Alert>
      ) : null}

      <WorkQueuePanel
        rows={workQueue}
        title="Assigned to you as a reviewer"
        description="Each item is a workflow step waiting on a decision. Marking one done only records what the review already decided."
        emptyTitle="No workflow steps waiting"
        emptyDescription="Verification steps appear here as learners submit evidence."
      />

      <Card>
        <CardHeader>
          <CardTitle>Open items</CardTitle>
          <CardDescription>Oldest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Nothing waiting"
              description="Submissions appear here as learners send work for review."
            />
          ) : (
            <ul className="space-y-3">
              {queue.map((item) => (
                <li key={item.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">
                      {item.evidence?.competencies?.name ?? "Evidence"}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {item.evidence?.ai_assistance_declared ? (
                        <Badge tone="warning">AI declared</Badge>
                      ) : null}
                      <Badge tone={item.status === "in_review" ? "brand" : "neutral"}>
                        {item.status === "in_review" ? "Claimed" : "Unclaimed"}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    Version {item.evidence?.version} · waiting {formatRelative(item.assigned_at)}
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm text-ink-muted">{item.evidence?.summary}</p>
                  <div className="mt-3">
                    <ClaimReviewButton
                      reviewId={item.id}
                      claimed={item.status === "in_review"}
                      isMine={item.reviewer_profile_id === actor.profileId}
                      action={claimReviewAction}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
