import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Gauge, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, EmptyState, Progress } from "@/components/ui/feedback";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import { getCompetencyGaps, getLatestAttempt } from "@/server/services/diagnostic-service";
import {
  GAP_SEVERITY_COPY,
  LEVEL_LABELS,
  compareByPriority,
  gapSeverity,
  progressToTarget,
  type CompetencyLevel,
} from "@/domain/competency/levels";
import { REACHABLE_BASELINE_LEVELS } from "@/domain/diagnostic/attempt";

export const metadata: Metadata = { title: "Your baseline" };

export default async function BaselineResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ scored?: string }>;
}) {
  const [{ scored }, actor] = await Promise.all([searchParams, requireActor()]);
  assertCan(actor, "learner.dashboard.view");

  const supabase = await createSupabaseServerClient();
  const [gaps, attempt] = await Promise.all([
    getCompetencyGaps(supabase, actor.profileId),
    getLatestAttempt(supabase, actor.profileId),
  ]);

  if (gaps.length === 0) {
    if (!attempt || attempt.status === "in_progress") redirect("/baseline");
    return (
      <EmptyState
        icon={Gauge}
        title="No baseline recorded yet"
        description="Complete the baseline diagnostic and your competency profile appears here."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/baseline">Start the baseline</Link>
          </Button>
        }
      />
    );
  }

  const ranked = [...gaps].sort(compareByPriority);
  const priorities = ranked.filter((g) => g.gap > 0).slice(0, 4);
  const met = ranked.filter((g) => g.gap === 0);

  const byDomain = new Map<string, typeof ranked>();
  for (const gap of ranked) {
    byDomain.set(gap.domain_name, [...(byDomain.get(gap.domain_name) ?? []), gap]);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Where you stand</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Measured from {attempt?.result?.answered ?? gaps.length} answers across{" "}
          {gaps.length} competencies. Every level below came from your own responses.
        </p>
      </div>

      {scored === "1" ? (
        <Alert tone="success" title="Baseline recorded">
          This is your starting point, not a verdict. Evidence from projects you build will
          supersede it.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-4 text-accent" aria-hidden /> Start here
            </CardTitle>
            <CardDescription>
              The widest gaps between where you are and the level treated as opportunity-ready.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {priorities.length === 0 ? (
              <EmptyState
                icon={Target}
                title="Every competency is at target"
                description="Your baseline puts you at or above target across the board. Projects and verified evidence are how you push past it."
              />
            ) : (
              <ol className="space-y-4">
                {priorities.map((gap) => {
                  const severity = gapSeverity(gap.level, gap.target_level);
                  return (
                    <li key={gap.competency_id} className="space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-ink">{gap.name}</p>
                        <Badge tone={severity === "priority" ? "warning" : "neutral"}>
                          {GAP_SEVERITY_COPY[severity]}
                        </Badge>
                      </div>
                      <Progress
                        value={progressToTarget(gap.level, gap.target_level)}
                        label={`${LEVEL_LABELS[gap.level as CompetencyLevel]} → ${
                          LEVEL_LABELS[gap.target_level as CompetencyLevel]
                        }`}
                      />
                      {gap.level_descriptor ? (
                        <p className="text-xs text-ink-subtle">{gap.level_descriptor}</p>
                      ) : null}
                      {gap.unmet_prerequisites.length > 0 ? (
                        <p className="text-xs text-warning">
                          Build first: {gap.unmet_prerequisites.join(", ")}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How this was measured</CardTitle>
            <CardDescription>So you can judge how much weight to give it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-ink-subtle">
            <p>
              Each competency got two questions: one at <strong className="text-ink">Developing</strong>,
              then a harder one if you got it right and an easier one if you did not. Your level is
              the highest one you answered correctly.
            </p>
            <p>
              Two questions cannot separate every level, so a baseline lands on{" "}
              {REACHABLE_BASELINE_LEVELS.map((l) => LEVEL_LABELS[l as CompetencyLevel]).join(", ")} —
              and each carries a confidence figure rather than being treated as settled.
            </p>
            <p className="text-ink-muted">
              {met.length} of {gaps.length} competencies are already at target.
            </p>
          </CardContent>
        </Card>
      </div>

      {Array.from(byDomain.entries()).map(([domain, items]) => (
        <Card key={domain}>
          <CardHeader>
            <CardTitle>{domain}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/8">
              {items.map((gap) => (
                <li key={gap.competency_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{gap.name}</p>
                    <p className="text-xs text-ink-subtle">
                      {LEVEL_LABELS[gap.level as CompetencyLevel]} · target{" "}
                      {LEVEL_LABELS[gap.target_level as CompetencyLevel]} ·{" "}
                      {Math.round(Number(gap.confidence) * 100)}% confidence
                    </p>
                  </div>
                  <Badge tone={gap.gap === 0 ? "success" : "neutral"}>
                    {gap.gap === 0 ? "At target" : `${gap.gap} to go`}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end">
        <Button asChild variant="secondary">
          <Link href="/dashboard">
            Back to dashboard <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
