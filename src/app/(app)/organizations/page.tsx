import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { CreateOrganizationForm } from "@/components/app/create-organization-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import { listOrganizationsForActor } from "@/server/services/organization-service";
import { getCohortOutcomesFor, listGovernedCohorts } from "@/server/services/outcomes-service";
import { CohortOutcomes } from "@/components/app/cohort-outcomes";
import {can} from "@/domain/identity/actor";
import { createOrganizationAction } from "@/server/actions/organizations";
import { getMyWorkQueue } from "@/server/services/workflow-service";
import { WorkQueuePanel } from "@/components/app/work-queue-panel";
import { PERSONA_LABELS } from "@/domain/identity/persona";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  const actor = await requireActor();
  // The page is a view over an authorized capability, never a substitute for it.
  requireCapability(actor, "organization.create");

  const supabase = await createSupabaseServerClient();
  const organizations = await listOrganizationsForActor(supabase);
  // Application decisions this organization owes, with their deadlines. The
  // decision is still made through advance_application on the opportunity.
  const workQueue = await getMyWorkQueue(supabase, { workflow: "opportunities" });

  // The cohort panel is only assembled for a persona that may read org
  // outcomes. Seeing it never implies access: `cohort_outcomes` re-authorizes
  // the caller against each cohort's organization.
  const showsCohorts = can(actor, "outcomes.read_org");
  const cohorts = showsCohorts
    ? await listGovernedCohorts(
        supabase,
        organizations.map((organization) => organization.id),
      )
    : [];
  const cohortOutcomes = showsCohorts
    ? await getCohortOutcomesFor(supabase, cohorts)
    : new Map();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Organizations</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Institutions, employers and sponsors you govern or belong to.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <WorkQueuePanel
        rows={workQueue}
        title="Applications waiting on a decision"
        description="Each item is a candidate waiting on your organization. Move the application, then mark the step done."
        emptyTitle="Nothing waiting"
        emptyDescription="Applications appear here as candidates apply to your openings."
      />

      <Card>
          <CardHeader>
            <CardTitle>Your organizations</CardTitle>
            <CardDescription>Only organizations your memberships allow you to see.</CardDescription>
          </CardHeader>
          <CardContent>
            {organizations.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No organizations yet"
                description="Create one to run programs, post challenges or fund cohorts."
              />
            ) : (
              <ul className="space-y-2">
                {organizations.map((organization) => {
                  const personas = actor.memberships
                    .filter((m) => m.organizationId === organization.id)
                    .map((m) => m.persona);
                  return (
                    <li
                      key={organization.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{organization.name}</p>
                        <p className="font-mono text-xs text-ink-subtle">
                          @{organization.slug} · {organization.type}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={organization.status === "active" ? "success" : "warning"}>
                          {organization.status}
                        </Badge>
                        {personas.map((persona) => (
                          <Badge key={persona} tone="brand">
                            {PERSONA_LABELS[persona]}
                          </Badge>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <CreateOrganizationForm action={createOrganizationAction} />
      </div>

      {showsCohorts ? <CohortOutcomes cohorts={cohorts} outcomes={cohortOutcomes} /> : null}
    </div>
  );
}
