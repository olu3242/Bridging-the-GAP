import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { OpportunityMatch } from "@/components/app/opportunity-match";
import { RefreshMatchesButton } from "@/components/app/refresh-matches-button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import {
  listMyApplications,
  listMyMatches,
  listOpenOpportunities,
  listShareableSkills,
} from "@/server/services/opportunity-service";
import { applyAction, refreshMatchesAction } from "@/server/actions/opportunities";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ applied?: string }>;
}) {
  const [{ applied }, actor] = await Promise.all([searchParams, requireActor()]);
  assertCan(actor, "opportunity.apply_own");

  const supabase = await createSupabaseServerClient();
  const [opportunities, matches, applications, shareable] = await Promise.all([
    listOpenOpportunities(supabase),
    listMyMatches(supabase, actor.profileId),
    listMyApplications(supabase, actor.profileId),
    listShareableSkills(supabase, actor.profileId),
  ]);

  const matchByOpportunity = new Map(matches.map((m) => [m.opportunity_id, m]));
  const appliedIds = new Set(
    applications.filter((a) => a.status !== "withdrawn").map((a) => a.opportunity_id),
  );
  const ranked = [...opportunities].sort(
    (a, b) => (matchByOpportunity.get(b.id)?.score ?? 0) - (matchByOpportunity.get(a.id)?.score ?? 0),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Opportunities</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Matched on verified skills only — a diagnostic level does not count.
          </p>
        </div>
        <RefreshMatchesButton action={refreshMatchesAction} />
      </div>

      {applied === "1" ? (
        <Alert tone="success" title="Application submitted">
          The employer sees only the verified skills you shared, with their evidence chain.
        </Alert>
      ) : null}

      {applications.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Your applications</CardTitle>
            <CardDescription>
              Each carries a snapshot of your match at the time you applied.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {applications.map((application) => {
                const opportunity = opportunities.find((o) => o.id === application.opportunity_id);
                return (
                  <li
                    key={application.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">
                        {opportunity?.title ?? "Opportunity"}
                      </p>
                      <p className="text-xs text-ink-subtle">
                        Applied {formatRelative(application.submitted_at)}
                        {application.match_snapshot.score != null
                          ? ` · ${application.match_snapshot.score}% fit at the time`
                          : ""}
                        {` · ${application.shared_verified_skill_ids.length} skills shared`}
                      </p>
                    </div>
                    <Badge tone={application.status === "withdrawn" ? "neutral" : "brand"}>
                      {application.status.replace("_", " ")}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {ranked.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No open opportunities"
          description="Openings appear here as partner organizations post them."
        />
      ) : (
        <div className="space-y-4">
          {ranked.map((opportunity) => (
            <OpportunityMatch
              key={opportunity.id}
              opportunity={opportunity}
              match={matchByOpportunity.get(opportunity.id) ?? null}
              applied={appliedIds.has(opportunity.id)}
              shareable={shareable}
              action={applyAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
