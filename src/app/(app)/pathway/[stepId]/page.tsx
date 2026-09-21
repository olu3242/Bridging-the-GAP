import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { LearningModule } from "@/components/app/learning-module";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import {
  getActivePathway,
  getCompletedActivityIds,
  getModuleActivities,
  getPathwaySteps,
  getStepLearning,
} from "@/server/services/pathway-service";
import { completeActivityAction } from "@/server/actions/pathway";
import { STEP_STATUS_COPY } from "@/domain/pathway/pathway";
import { LEVEL_LABELS, type CompetencyLevel } from "@/domain/competency/levels";
import type { LearningActivityRow } from "@/lib/db/types";

export const metadata: Metadata = { title: "Pathway step" };

export default async function PathwayStepPage({ params }: { params: Promise<{ stepId: string }> }) {
  const [{ stepId }, actor] = await Promise.all([params, requireActor()]);
  requireCapability(actor, "learner.dashboard.view");

  const supabase = await createSupabaseServerClient();
  const pathway = await getActivePathway(supabase, actor.profileId);
  if (!pathway) notFound();

  // RLS already scopes this to the learner; the step must belong to their plan.
  const steps = await getPathwaySteps(supabase, pathway.id);
  const step = steps.find((s) => s.id === stepId);
  if (!step) notFound();

  const [modules, completedIds] = await Promise.all([
    getStepLearning(supabase, actor.profileId, stepId),
    getCompletedActivityIds(supabase, actor.profileId),
  ]);

  const activitiesByModule = new Map<string, LearningActivityRow[]>();
  for (const enrolment of modules) {
    activitiesByModule.set(
      enrolment.module_id,
      (await getModuleActivities(supabase, enrolment.module_id)) as LearningActivityRow[],
    );
  }

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/pathway">
          <ArrowLeft className="size-4" aria-hidden /> Pathway
        </Link>
      </Button>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-subtle">
            Step {String(step.position).padStart(2, "0")}
          </span>
          <Badge tone={step.status === "completed" ? "success" : "brand"}>
            {STEP_STATUS_COPY[step.status]}
          </Badge>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {step.competency_name}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{step.rationale}</p>
        <p className="mt-1 text-xs text-ink-subtle">
          {LEVEL_LABELS[step.from_level as CompetencyLevel]} →{" "}
          {LEVEL_LABELS[step.target_level as CompetencyLevel]}
        </p>
      </div>

      {step.evidence_requirement ? (
        <Alert tone="info" title="What will prove it">
          {step.evidence_requirement}
        </Alert>
      ) : null}

      {modules.length === 0 ? (
        <Alert tone="info">
          No learning is published for this competency yet. The step stays open until there is
          something real to work through.
        </Alert>
      ) : (
        <div className="space-y-4">
          {modules.map((enrolment) => (
            <LearningModule
              key={enrolment.module_id}
              module={enrolment}
              activities={activitiesByModule.get(enrolment.module_id) ?? []}
              completedIds={[...completedIds]}
              stepId={stepId}
              action={completeActivityAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
