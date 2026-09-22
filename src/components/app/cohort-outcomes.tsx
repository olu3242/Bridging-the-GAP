import { Users2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import type { CohortOutcomeRow } from "@/lib/db/types";
import type { CohortSummary } from "@/server/services/outcomes-service";

/**
 * The governed organization read surface over E17. Aggregates only: no
 * per-learner row is fetched or rendered, because the database does not return
 * one. A cohort the database refuses to report says why rather than showing
 * zeros that would read as "nobody is progressing".
 */
export function CohortOutcomes({
  cohorts,
  outcomes,
}: {
  cohorts: readonly CohortSummary[];
  outcomes: Map<string, CohortOutcomeRow | null>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users2 className="size-4 text-accent" aria-hidden /> Cohort outcomes
        </CardTitle>
        <CardDescription>
          Counted from your members&apos; own records. Aggregates only — no individual learner is
          shown.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cohorts.length === 0 ? (
          <EmptyState
            icon={Users2}
            title="No cohorts yet"
            description="A cohort groups the learners your organization sponsors or teaches."
          />
        ) : (
          <ul className="space-y-3">
            {cohorts.map((cohort) => {
              const row = outcomes.get(cohort.id) ?? null;
              return (
                <li
                  key={cohort.id}
                  className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{cohort.name}</p>
                      <p className="font-mono text-xs text-ink-subtle">@{cohort.slug}</p>
                    </div>
                    <Badge>{cohort.member_count} learners</Badge>
                  </div>
                  {row === null ? (
                    <p className="mt-2 text-xs text-ink-subtle">
                      Outcomes are reported once a cohort reaches five learners — below that, an
                      aggregate identifies the individual.
                    </p>
                  ) : (
                    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(
                        [
                          ["Baseline", row.with_baseline],
                          ["Pathway", row.with_pathway],
                          ["Projects done", row.with_completed_project],
                          ["Skills verified", row.with_verified_skill],
                          ["Credentials", row.with_credential],
                          ["Applied", row.with_application],
                          ["Offers", row.with_offer],
                          ["Median skills", row.median_skills_verified ?? 0],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-xs uppercase tracking-wide text-ink-subtle">
                            {label}
                          </dt>
                          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
