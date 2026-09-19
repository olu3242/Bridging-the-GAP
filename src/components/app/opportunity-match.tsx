"use client";
import { useActionState, useState } from "react";
import { Check, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Alert, Badge, Progress } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import { LEVEL_LABELS, type CompetencyLevel } from "@/domain/competency/levels";
import type { MatchFactor, OpportunityMatchRow, OpportunityRow, PortfolioRow } from "@/lib/db/types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

function FactorRow({ factor, met }: { factor: MatchFactor; met: boolean }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={`mt-0.5 ${met ? "text-success" : "text-warning"}`}>
        {met ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
      </span>
      <span className="text-ink-muted">
        <span className="text-ink">{factor.name}</span>
        {factor.is_required ? "" : " (desirable)"} — needs{" "}
        {LEVEL_LABELS[factor.required_level as CompetencyLevel]}
        {met
          ? `, verified at ${LEVEL_LABELS[factor.verified_level as CompetencyLevel]}`
          : `: ${factor.reason ?? "not met"}`}
      </span>
    </li>
  );
}

export function OpportunityMatch({
  opportunity,
  match,
  applied,
  shareable,
  action,
}: {
  opportunity: OpportunityRow;
  match: OpportunityMatchRow | null;
  applied: boolean;
  shareable: PortfolioRow[];
  action: Action;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const [open, setOpen] = useState(false);

  const matched = match?.matched ?? [];
  const missing = match?.missing ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{opportunity.kind}</Badge>
            {opportunity.is_remote ? <Badge>Remote</Badge> : null}
            {applied ? <Badge tone="success">Applied</Badge> : null}
          </div>
          {match ? (
            <span className="font-mono text-xs text-ink-subtle">{match.score}% fit</span>
          ) : null}
        </div>
        <CardTitle className="mt-1">{opportunity.title}</CardTitle>
        <CardDescription>
          {opportunity.location ?? "Location flexible"}
          {opportunity.weekly_hours ? ` · ${opportunity.weekly_hours}h a week` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">{opportunity.description}</p>

        {match ? (
          <>
            <Progress value={match.score} label="Fit from your verified skills" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Why you match
                </p>
                <ul className="mt-2 space-y-1.5">
                  {matched.length === 0 ? (
                    <li className="text-xs text-ink-subtle">Nothing verified for this one yet.</li>
                  ) : (
                    matched.map((factor) => (
                      <FactorRow key={factor.competency} factor={factor} met />
                    ))
                  )}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  What is missing
                </p>
                <ul className="mt-2 space-y-1.5">
                  {missing.length === 0 ? (
                    <li className="text-xs text-success">Every requirement is met.</li>
                  ) : (
                    missing.map((factor) => (
                      <FactorRow key={factor.competency} factor={factor} met={false} />
                    ))
                  )}
                </ul>
              </div>
            </div>
          </>
        ) : (
          <Alert tone="info">
            No match computed yet. Refresh to score this against your verified skills.
          </Alert>
        )}

        {applied ? null : (
          <div>
            {open ? (
              <form action={formAction} className="space-y-4 rounded-xl border border-white/8 p-4">
                <input type="hidden" name="opportunityId" value={opportunity.id} />
                {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-ink-muted">
                    Verified skills to share
                  </legend>
                  <p className="text-xs text-ink-subtle">
                    Only what you tick is disclosed. Nothing else about you is shared.
                  </p>
                  {shareable.length === 0 ? (
                    <p className="text-xs text-warning">
                      You have no verified skills yet, so an application would carry no evidence.
                    </p>
                  ) : (
                    shareable.map((skill) => (
                      <label
                        key={skill.verified_skill_id}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm has-[:checked]:border-brand/50 has-[:checked]:bg-brand/10"
                      >
                        <input
                          type="checkbox"
                          name="sharedSkillIds"
                          value={skill.verified_skill_id}
                          defaultChecked
                          className="size-4 accent-[var(--color-brand)]"
                        />
                        <span className="text-ink">
                          {skill.competency_name} ·{" "}
                          {LEVEL_LABELS[skill.level as CompetencyLevel]}
                        </span>
                      </label>
                    ))
                  )}
                </fieldset>

                <Field label="Anything to add" htmlFor={`note-${opportunity.id}`} hint="Optional.">
                  <Textarea id={`note-${opportunity.id}`} name="note" />
                </Field>

                <SubmitButton size="sm" pendingLabel="Applying…">
                  Submit application
                </SubmitButton>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-sm text-accent underline-offset-4 hover:underline"
              >
                Apply with my verified evidence →
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
