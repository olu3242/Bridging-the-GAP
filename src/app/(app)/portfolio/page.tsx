import type { Metadata } from "next";
import Link from "next/link";
import { Award, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import { getCredentials, getPortfolio } from "@/server/services/project-service";
import { LEVEL_LABELS, type CompetencyLevel } from "@/domain/competency/levels";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const actor = await requireActor();
  assertCan(actor, "credential.read_own");

  const supabase = await createSupabaseServerClient();
  const [skills, credentials] = await Promise.all([
    getPortfolio(supabase, actor.profileId),
    getCredentials(supabase, actor.profileId),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Portfolio</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every claim here traces to evidence you produced and a person who reviewed it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="size-4 text-accent" aria-hidden /> Credentials
          </CardTitle>
          <CardDescription>Issued only when the required skills are verified.</CardDescription>
        </CardHeader>
        <CardContent>
          {credentials.length === 0 ? (
            <EmptyState
              icon={Award}
              title="No credentials yet"
              description="A credential is issued automatically once every competency it requires is verified from reviewed evidence."
            />
          ) : (
            <ul className="space-y-2">
              {credentials.map((credential) => (
                <li
                  key={credential.id}
                  className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{credential.title}</p>
                    <Badge tone={credential.status === "issued" ? "success" : "warning"}>
                      {credential.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    Issued {formatRelative(credential.issued_at)} · requires{" "}
                    {(credential.criteria.required_competencies ?? []).length} verified skills at{" "}
                    {LEVEL_LABELS[(credential.criteria.min_level ?? 3) as CompetencyLevel]}
                  </p>
                  {credential.revocation_reason ? (
                    <p className="mt-1 text-xs text-danger">Revoked: {credential.revocation_reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-accent" aria-hidden /> Verified skills
          </CardTitle>
          <CardDescription>
            The full chain: what you built, who reviewed it, and what they said.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {skills.length === 0 ? (
            <EmptyState
              icon={BadgeCheck}
              title="Nothing verified yet"
              description="Complete a project on your pathway and submit it for review."
              action={
                <Button asChild size="sm" variant="secondary">
                  <Link href="/pathway">Go to your pathway</Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {skills.map((skill) => (
                <li
                  key={skill.verified_skill_id}
                  className="rounded-xl border border-white/8 bg-white/[0.03] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{skill.competency_name}</p>
                    <Badge tone="success">
                      {LEVEL_LABELS[skill.level as CompetencyLevel]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {skill.domain_name} · verified {formatRelative(skill.verified_at)} by{" "}
                    {skill.reviewer_name}
                  </p>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div>
                      <dt className="text-ink-subtle">Evidence (v{skill.evidence_version})</dt>
                      <dd className="mt-0.5 text-ink-muted">{skill.evidence_summary}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-subtle">Project</dt>
                      <dd className="mt-0.5 text-ink-muted">{skill.project_title}</dd>
                    </div>
                    {skill.reviewer_rationale ? (
                      <div>
                        <dt className="text-ink-subtle">Reviewer&apos;s reasoning</dt>
                        <dd className="mt-0.5 text-ink-muted">{skill.reviewer_rationale}</dd>
                      </div>
                    ) : null}
                    {skill.ai_assistance_declared ? (
                      <div>
                        <dt className="text-ink-subtle">Integrity</dt>
                        <dd className="mt-0.5 text-ink-muted">AI assistance was declared.</dd>
                      </div>
                    ) : null}
                  </dl>
                  {skill.artifact_url ? (
                    <a
                      href={skill.artifact_url}
                      className="mt-2 inline-block text-xs text-accent underline-offset-4 hover:underline"
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      Open the work
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
