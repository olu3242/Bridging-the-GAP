import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { EvidenceForm } from "@/components/app/evidence-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import {
  getEvidenceReviews,
  getProject,
  getProjectEvidence,
} from "@/server/services/project-service";
import { submitEvidenceAction } from "@/server/actions/projects";
import { PROJECT_STATUS_COPY, isOpenForSubmission, type ProjectStatus } from "@/domain/evidence/verification";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const [{ projectId }, { submitted }, actor] = await Promise.all([
    params,
    searchParams,
    requireActor(),
  ]);
  requireCapability(actor, "project.manage_own");

  const supabase = await createSupabaseServerClient();
  const project = (await getProject(supabase, projectId)) as unknown as {
    id: string;
    status: ProjectStatus;
    profile_id: string;
    project_briefs: {
      title: string;
      brief: string;
      expected_evidence: string;
      kind: string;
      estimated_hours: number;
    };
    competencies: { name: string };
  } | null;
  if (!project || project.profile_id !== actor.profileId) notFound();

  const evidence = await getProjectEvidence(supabase, projectId);
  const reviews = await getEvidenceReviews(
    supabase,
    evidence.map((e) => e.id),
  );
  const reviewByEvidence = new Map(
    (reviews as Array<{ evidence_id: string; status: string; rationale: string | null; decided_at: string | null }>)
      .map((r) => [r.evidence_id, r]),
  );

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/projects">
          <ArrowLeft className="size-4" aria-hidden /> Projects
        </Link>
      </Button>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{project.project_briefs.kind}</Badge>
          <Badge tone={project.status === "completed" ? "success" : "neutral"}>
            {PROJECT_STATUS_COPY[project.status]}
          </Badge>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {project.project_briefs.title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {project.competencies.name} · about {project.project_briefs.estimated_hours} hours
        </p>
      </div>

      {submitted === "1" ? (
        <Alert tone="success" title="Submitted for review">
          A reviewer will score it against the rubric. You will be notified either way.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>The brief</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-muted">{project.project_briefs.brief}</p>
          <Alert tone="info" title="What counts as evidence">
            {project.project_briefs.expected_evidence}
          </Alert>
        </CardContent>
      </Card>

      {evidence.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Your submissions</CardTitle>
            <CardDescription>
              Newest first. Nothing is overwritten — each revision is its own version.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {evidence.map((item) => {
                const review = reviewByEvidence.get(item.id);
                return (
                  <li key={item.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-ink">Version {item.version}</p>
                      <Badge
                        tone={
                          item.status === "accepted"
                            ? "success"
                            : item.status === "rejected"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {item.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-subtle">
                      Submitted {formatRelative(item.submitted_at)}
                      {item.ai_assistance_declared ? " · AI assistance declared" : ""}
                    </p>
                    <p className="mt-2 text-sm text-ink-muted">{item.summary}</p>
                    {item.artifact_url ? (
                      <a
                        href={item.artifact_url}
                        className="mt-2 inline-block text-xs text-accent underline-offset-4 hover:underline"
                        rel="noreferrer noopener"
                        target="_blank"
                      >
                        Open the work
                      </a>
                    ) : null}
                    {review?.rationale ? (
                      <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
                        <p className="text-xs font-medium text-ink-muted">Reviewer</p>
                        <p className="mt-0.5 text-sm text-ink-muted">{review.rationale}</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {isOpenForSubmission(project.status) ? (
        <EvidenceForm
          projectId={projectId}
          expectedEvidence={project.project_briefs.expected_evidence}
          action={submitEvidenceAction}
          isResubmission={evidence.length > 0}
        />
      ) : project.status === "under_review" || project.status === "submitted" ? (
        <Alert tone="info" title="With a reviewer">
          Your submission is in the review queue. You will be notified when a decision is recorded.
        </Alert>
      ) : null}
    </div>
  );
}
