import type { Metadata } from "next";
import Link from "next/link";
import { Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { AssignProjectButton } from "@/components/app/assign-project-button";
import { assignProjectAction } from "@/server/actions/projects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import { listBriefsForCompetency, listProjects } from "@/server/services/project-service";
import { getActivePathway, getPathwaySteps } from "@/server/services/pathway-service";
import { PROJECT_STATUS_COPY, type ProjectStatus } from "@/domain/evidence/verification";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const actor = await requireActor();
  requireCapability(actor, "project.manage_own");

  const supabase = await createSupabaseServerClient();
  const [projects, pathway] = await Promise.all([
    listProjects(supabase, actor.profileId),
    getActivePathway(supabase, actor.profileId),
  ]);

  // Briefs are offered for the competencies the pathway has actually opened,
  // so the list never suggests work the plan has not reached.
  const steps = pathway ? await getPathwaySteps(supabase, pathway.id) : [];
  const openCompetencies = steps
    .filter((s) => s.status === "available" || s.status === "in_progress")
    .map((s) => ({ competencyId: s.competency_id, stepId: s.id, name: s.competency_name }));

  const briefsByCompetency = await Promise.all(
    openCompetencies.map(async (entry) => ({
      ...entry,
      briefs: await listBriefsForCompetency(supabase, entry.competencyId),
    })),
  );

  const takenBriefIds = new Set(
    (projects as Array<{ brief_id: string; status: string }>)
      .filter((p) => p.status !== "withdrawn")
      .map((p) => p.brief_id),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Projects</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Work that produces the evidence behind a verified skill.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your projects</CardTitle>
          <CardDescription>Every submission is versioned and reviewed by a person.</CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <EmptyState
              icon={Hammer}
              title="No projects yet"
              description="Open a step on your pathway and take on the brief attached to it."
              action={
                <Button asChild size="sm" variant="secondary">
                  <Link href="/pathway">Go to your pathway</Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {(projects as Array<Record<string, never>>).map((project) => {
                const row = project as unknown as {
                  id: string;
                  status: ProjectStatus;
                  assigned_at: string;
                  project_briefs: { title: string; kind: string } | null;
                  competencies: { name: string } | null;
                };
                return (
                  <li key={row.id}>
                    <Link
                      href={`/projects/${row.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 transition-colors hover:bg-white/[0.06]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{row.project_briefs?.title}</p>
                        <p className="text-xs text-ink-subtle">
                          {row.competencies?.name} · started {formatRelative(row.assigned_at)}
                        </p>
                      </div>
                      <Badge tone={row.status === "completed" ? "success" : "neutral"}>
                        {PROJECT_STATUS_COPY[row.status]}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {briefsByCompetency.some((entry) => entry.briefs.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>Available on your pathway</CardTitle>
            <CardDescription>
              Only briefs for steps your plan has opened. Locked steps do not appear.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {briefsByCompetency.map((entry) =>
              entry.briefs
                .filter((brief) => !takenBriefIds.has(brief.id))
                .map((brief) => (
                  <div
                    key={brief.id}
                    className="rounded-xl border border-white/8 bg-white/[0.03] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{brief.kind}</Badge>
                      <p className="text-sm font-medium text-ink">{brief.title}</p>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-subtle">{brief.brief}</p>
                    <p className="mt-2 text-xs text-ink-muted">
                      Expected evidence: {brief.expected_evidence}
                    </p>
                    <div className="mt-3">
                      <AssignProjectButton
                        briefSlug={brief.slug}
                        stepId={entry.stepId}
                        action={assignProjectAction}
                      />
                    </div>
                  </div>
                )),
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
