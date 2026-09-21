import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PathwayGenerate } from "@/components/app/pathway-generate";
import { PathwayPlan } from "@/components/app/pathway-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import { getActivePathway, getPathwaySteps } from "@/server/services/pathway-service";
import { getCompetencyGaps } from "@/server/services/diagnostic-service";
import { generatePathwayAction, startStepAction } from "@/server/actions/pathway";

export const metadata: Metadata = { title: "Pathway" };

export default async function PathwayPage({
  searchParams,
}: {
  searchParams: Promise<{ generated?: string }>;
}) {
  const [{ generated }, actor] = await Promise.all([searchParams, requireActor()]);
  requireCapability(actor, "learner.dashboard.view");

  const supabase = await createSupabaseServerClient();
  const pathway = await getActivePathway(supabase, actor.profileId);

  if (!pathway) {
    const gaps = await getCompetencyGaps(supabase, actor.profileId);
    if (gaps.length === 0) redirect("/baseline");
    return (
      <PathwayGenerate action={generatePathwayAction} gapCount={gaps.filter((g) => g.gap > 0).length} />
    );
  }

  const steps = await getPathwaySteps(supabase, pathway.id);
  return (
    <PathwayPlan
      pathway={pathway}
      steps={steps}
      startAction={startStepAction}
      generated={generated === "1"}
    />
  );
}
