import type { Metadata } from "next";
import Link from "next/link";
import { Activity, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import { getLearnerOutcomes, getOutcomeTimeline } from "@/server/services/outcomes-service";
import { FUNNEL_STEPS, OUTCOME_LABELS } from "@/domain/outcomes/stages";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Your outcomes" };

export default async function OutcomesPage() {
  const actor = await requireActor();
  assertCan(actor, "outcomes.read_own");

  const supabase = await createSupabaseServerClient();
  const [outcomes, timeline] = await Promise.all([
    getLearnerOutcomes(supabase, actor.profileId),
    getOutcomeTimeline(supabase, actor.profileId),
  ]);

  const counts = outcomes as unknown as Record<string, number> | null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your outcomes</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every number here is counted from your own records — nothing is estimated.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4 text-accent" aria-hidden /> Skill to opportunity
          </CardTitle>
          <CardDescription>
            How far your work has carried, from a measured baseline to an offer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {counts === null ? (
            <EmptyState
              icon={TrendingUp}
              title="Nothing measured yet"
              description="Your funnel fills as you move through the platform."
              action={
                <Button asChild size="sm" variant="secondary">
                  <Link href="/baseline">Start the baseline</Link>
                </Button>
              }
            />
          ) : (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {FUNNEL_STEPS.map((step) => (
                <div
                  key={step.key}
                  className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
                >
                  <dt className="text-xs uppercase tracking-wide text-ink-subtle">{step.label}</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink">
                    {counts[step.field] ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-accent" aria-hidden /> What happened
          </CardTitle>
          <CardDescription>
            Read from the audit ledger. Each entry is a recorded transition, not a summary.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No milestones yet"
              description="Milestones appear here as you reach them."
            />
          ) : (
            <ol className="space-y-2">
              {timeline.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      {OUTCOME_LABELS[event.outcome] ?? event.action}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {formatRelative(event.occurred_at)} · stage {event.stage}
                    </p>
                  </div>
                  <Badge
                    tone={
                      event.severity === "critical"
                        ? "success"
                        : event.severity === "notice"
                          ? "brand"
                          : "neutral"
                    }
                  >
                    {event.object_type}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
