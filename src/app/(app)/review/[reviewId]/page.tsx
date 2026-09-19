import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { ReviewDecisionForm } from "@/components/app/review-decision-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import { getReview, getRubricCriteria } from "@/server/services/review-service";
import { decideReviewAction } from "@/server/actions/review";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const [{ reviewId }, actor] = await Promise.all([params, requireActor()]);
  assertCan(actor, "review.decide");

  const supabase = await createSupabaseServerClient();
  const review = (await getReview(supabase, reviewId)) as unknown as {
    id: string;
    status: string;
    claimed_at: string | null;
    decided_at: string | null;
    rationale: string | null;
    reviewer_profile_id: string | null;
    evidence: {
      id: string;
      version: number;
      summary: string;
      artifact_url: string | null;
      ai_assistance_declared: boolean;
      ai_assistance_note: string | null;
      rubric_id: string;
      submitted_at: string;
      competencies: { name: string } | null;
    } | null;
  } | null;

  if (!review?.evidence) notFound();
  const criteria = await getRubricCriteria(supabase, review.evidence.rubric_id);
  const isClaimedByMe = review.status === "in_review" && review.reviewer_profile_id === actor.profileId;

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/review">
          <ArrowLeft className="size-4" aria-hidden /> Review queue
        </Link>
      </Button>

      <div>
        <Badge tone="brand">{review.evidence.competencies?.name}</Badge>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Evidence, version {review.evidence.version}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Submitted {formatRelative(review.evidence.submitted_at)}
        </p>
      </div>

      {review.evidence.ai_assistance_declared ? (
        <Alert tone="info" title="AI assistance was declared">
          {review.evidence.ai_assistance_note ?? "No detail given."}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What the learner submitted</CardTitle>
          <CardDescription>Judge this against the rubric, not against your impression.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">
            {review.evidence.summary}
          </p>
          {review.evidence.artifact_url ? (
            <a
              href={review.evidence.artifact_url}
              className="inline-block text-sm text-accent underline-offset-4 hover:underline"
              rel="noreferrer noopener"
              target="_blank"
            >
              Open the work
            </a>
          ) : (
            <p className="text-xs text-ink-subtle">No link was provided with this submission.</p>
          )}
        </CardContent>
      </Card>

      {review.decided_at ? (
        <Alert tone="info" title={`Already decided: ${review.status.replace("_", " ")}`}>
          {review.rationale}
        </Alert>
      ) : isClaimedByMe ? (
        <ReviewDecisionForm reviewId={reviewId} criteria={criteria} action={decideReviewAction} />
      ) : (
        <Alert tone="info" title="Claim this review first">
          Only the reviewer who claimed an item may decide it.
        </Alert>
      )}
    </div>
  );
}
