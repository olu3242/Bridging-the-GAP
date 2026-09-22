import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { TutorPanel } from "@/components/app/tutor-panel";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import {
  getTutorContext,
  isTutorProviderConfigured,
  listTutorTurns,
  openTutorSession,
} from "@/server/services/tutor-service";
import { getActivePathway, getPathwaySteps } from "@/server/services/pathway-service";
import { askTutorAction } from "@/server/actions/tutor";
import { nextStep } from "@/domain/pathway/pathway";

export const metadata: Metadata = { title: "AI tutor" };

export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const [{ step }, actor] = await Promise.all([searchParams, requireActor()]);
  requireCapability(actor, "learner.dashboard.view");

  const supabase = await createSupabaseServerClient();
  const pathway = await getActivePathway(supabase, actor.profileId);
  if (!pathway) {
    return (
      <EmptyState
        icon={Bot}
        title="The tutor needs a pathway first"
        description="It coaches against a competency your plan has opened, so it has real context to work from."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/pathway">Build your pathway</Link>
          </Button>
        }
      />
    );
  }

  const steps = await getPathwaySteps(supabase, pathway.id);
  // Default to the step the learner is actually on.
  const target = step ? steps.find((s) => s.id === step) : nextStep(steps);

  if (!target) {
    return (
      <EmptyState
        icon={Bot}
        title="No open step to coach"
        description="Open a step on your pathway and the tutor can work with you on it."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/pathway">Go to your pathway</Link>
          </Button>
        }
      />
    );
  }

  const session = await openTutorSession(supabase, { stepId: target.id });
  const [turns, context] = await Promise.all([
    listTutorTurns(supabase, session.id),
    getTutorContext(supabase, session.id),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI tutor</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Working on step {target.position}: {target.competency_name}
        </p>
      </div>

      <TutorPanel
        sessionId={session.id}
        turns={turns}
        competencyName={context.competency?.name ?? target.competency_name}
        providerConfigured={isTutorProviderConfigured()}
        action={askTutorAction}
      />
    </div>
  );
}
