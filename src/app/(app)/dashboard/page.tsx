import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Gauge, History, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { NotificationInbox } from "@/components/app/notification-inbox";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { getLearnerProfile, getProfile } from "@/server/services/onboarding-service";
import { listNotifications } from "@/server/services/notification-service";
import { listOrganizationsForActor } from "@/server/services/organization-service";
import { getCompetencyGaps } from "@/server/services/diagnostic-service";
import { getLearnerOutcomes } from "@/server/services/outcomes-service";
import { FUNNEL_STEPS } from "@/domain/outcomes/stages";
import { compareByPriority, gapSeverity, GAP_SEVERITY_COPY, LEVEL_LABELS, type CompetencyLevel } from "@/domain/competency/levels";
import { markNotificationReadAction } from "@/server/actions/notifications";
import { PERSONA_LABELS } from "@/domain/identity/persona";
import { personasOf } from "@/domain/identity/actor";
import { formatRelative } from "@/lib/utils";
import type { AuditEventRow } from "@/lib/db/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const [{ welcome }, actor] = await Promise.all([searchParams, requireActor()]);
  const supabase = await createSupabaseServerClient();

  const [profile, learnerProfile, notifications, organizations, gaps, outcomes, auditResult] =
    await Promise.all([
    getProfile(supabase, actor.profileId),
    getLearnerProfile(supabase, actor.profileId),
    listNotifications(supabase, actor.profileId),
    listOrganizationsForActor(supabase),
    getCompetencyGaps(supabase, actor.profileId),
    getLearnerOutcomes(supabase, actor.profileId),
    supabase
      .from("audit_events")
      .select("id, action, object_type, occurred_at")
      .eq("actor_profile_id", actor.profileId)
      .order("occurred_at", { ascending: false })
      .limit(6),
    ]);

  const outcomeCounts = outcomes as unknown as Record<string, number> | null;
  const onboardingState = profile?.onboarding_state ?? "not_started";
  const onboardingComplete = onboardingState === "completed";
  const auditEvents = (auditResult.data ?? []) as Pick<
    AuditEventRow,
    "id" | "action" | "object_type" | "occurred_at"
  >[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Welcome back, {actor.displayName.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {onboardingComplete
              ? "Your account is set up. Your baseline diagnostic is the next milestone."
              : "Finish setting up your account so your pathway can be built from real data."}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {personasOf(actor).map((persona) => (
            <Badge key={persona} tone={persona === actor.primaryPersona ? "brand" : "neutral"}>
              {PERSONA_LABELS[persona]}
            </Badge>
          ))}
        </div>
      </div>

      {welcome === "1" && onboardingComplete ? (
        <Alert tone="success" title="Onboarding complete">
          Your goals and consents are recorded. Every recommendation from here is built on them.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4 text-accent" aria-hidden /> Your baseline
            </CardTitle>
            <CardDescription>
              Measured levels from your own diagnostic answers — Diagnostic and Competency engines.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {gaps.length === 0 ? (
              <EmptyState
                icon={Gauge}
                title="No baseline yet"
                description="A short adaptive diagnostic finds your level across eight competencies."
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/baseline">Start the baseline</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  {gaps.filter((g) => g.gap === 0).length} of {gaps.length} competencies at target.
                </p>
                <ul className="space-y-2">
                  {[...gaps]
                    .sort(compareByPriority)
                    .filter((g) => g.gap > 0)
                    .slice(0, 3)
                    .map((gap) => (
                      <li
                        key={gap.competency_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{gap.name}</p>
                          <p className="text-xs text-ink-subtle">
                            {LEVEL_LABELS[gap.level as CompetencyLevel]} → {LEVEL_LABELS[gap.target_level as CompetencyLevel]}
                          </p>
                        </div>
                        <Badge tone={gapSeverity(gap.level, gap.target_level) === "priority" ? "warning" : "neutral"}>
                          {GAP_SEVERITY_COPY[gapSeverity(gap.level, gap.target_level)]}
                        </Badge>
                      </li>
                    ))}
                </ul>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/baseline/results">
                    See the full baseline <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-4 text-accent" aria-hidden /> What you&apos;re working towards
            </CardTitle>
            <CardDescription>From your onboarding goals — the basis of your pathway.</CardDescription>
          </CardHeader>
          <CardContent>
            {learnerProfile ? (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-subtle">Goal</dt>
                  <dd className="mt-0.5 text-ink">{learnerProfile.primary_goal}</dd>
                </div>
                <div className="flex gap-8">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-subtle">Level</dt>
                    <dd className="mt-0.5 capitalize text-ink">{learnerProfile.experience_level}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-subtle">Weekly hours</dt>
                    <dd className="mt-0.5 tabular-nums text-ink">{learnerProfile.weekly_hours}</dd>
                  </div>
                </div>
                {learnerProfile.focus_areas.length > 0 ? (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-subtle">Focus areas</dt>
                    <dd className="mt-1.5 flex flex-wrap gap-1.5">
                      {learnerProfile.focus_areas.map((area) => (
                        <Badge key={area}>{area}</Badge>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <EmptyState
                icon={Target}
                title="No goal recorded yet"
                description="Your goal is captured during onboarding and drives every recommendation."
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/onboarding">Set your goal</Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-accent" aria-hidden /> Organizations
            </CardTitle>
            <CardDescription>Institutions, employers and sponsors you belong to.</CardDescription>
          </CardHeader>
          <CardContent>
            {organizations.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No organizations yet"
                description="Create one if you run a program, or wait for an invitation to arrive."
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/organizations">Create an organization</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {organizations.slice(0, 5).map((organization) => {
                  const persona = actor.memberships.find(
                    (m) => m.organizationId === organization.id,
                  )?.persona;
                  return (
                    <li
                      key={organization.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{organization.name}</p>
                        <p className="text-xs capitalize text-ink-subtle">
                          {organization.type} · {organization.status}
                        </p>
                      </div>
                      {persona ? <Badge tone="brand">{PERSONA_LABELS[persona]}</Badge> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <NotificationInbox notifications={notifications} action={markNotificationReadAction} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-4 text-accent" aria-hidden /> Your activity
            </CardTitle>
            <CardDescription>Straight from the audit ledger — nothing is inferred.</CardDescription>
          </CardHeader>
          <CardContent>
            {auditEvents.length === 0 ? (
              <EmptyState
                icon={History}
                title="No recorded activity yet"
                description="Actions you take on BTG are written to an append-only ledger you can read."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {auditEvents.map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-xs text-ink-muted">{event.action}</span>
                    <span className="shrink-0 text-xs text-ink-subtle">
                      {formatRelative(event.occurred_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="outcomes" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="outcomes"
            className="text-sm font-medium uppercase tracking-[0.18em] text-ink-subtle"
          >
            How far your work has carried
          </h2>
          <Button asChild size="sm" variant="ghost">
            <Link href="/outcomes">
              Full breakdown <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
        {outcomeCounts === null ? (
          <p className="rounded-2xl border border-dashed border-white/12 p-4 text-sm text-ink-subtle">
            Your outcome funnel fills from your own records as you move through the platform.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {FUNNEL_STEPS.map((step) => (
              <div
                key={step.key}
                className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"
              >
                <dt className="text-xs uppercase tracking-wide text-ink-subtle">{step.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                  {outcomeCounts[step.field] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
