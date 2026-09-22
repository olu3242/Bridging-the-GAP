"use client";
import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert, Progress } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";
import { submitOnboardingStepAction } from "@/server/actions/onboarding";
import {
  ONBOARDING_STEPS,
  PERSONA_INTENT_COPY,
  SELECTABLE_PERSONAS,
  progressPercent,
  stepIndex,
} from "@/domain/identity/onboarding";
import type { OnboardingState } from "@/domain/identity/lifecycle";
import { PERSONA_LABELS } from "@/domain/identity/persona";
import type { LearnerProfileRow, ProfileRow } from "@/lib/db/types";

const FOCUS_AREA_SUGGESTIONS = [
  "Software engineering",
  "Data & analytics",
  "Product design",
  "Cybersecurity",
  "Cloud & DevOps",
  "AI & machine learning",
];

export function OnboardingFlow({
  state: onboardingState,
  profile,
  learnerProfile,
}: {
  state: OnboardingState;
  profile: ProfileRow;
  learnerProfile: LearnerProfileRow | null;
}) {
  const [state, formAction] = useActionState(submitOnboardingStepAction, idleState);
  const step = onboardingState === "not_started" ? "profile" : onboardingState;
  const meta = ONBOARDING_STEPS.find((s) => s.state === step) ?? ONBOARDING_STEPS[0];
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <Progress
        value={progressPercent(onboardingState)}
        label={`Step ${stepIndex(onboardingState) + 1} of ${ONBOARDING_STEPS.length} — ${meta.title}`}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{meta.title}</CardTitle>
          <CardDescription>{meta.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4" noValidate>
            <input type="hidden" name="step" value={step} />
            {state.status === "error" && !state.fieldErrors ? (
              <Alert tone="error">{state.message}</Alert>
            ) : null}

            {step === "profile" ? (
              <>
                <Field label="Display name" htmlFor="displayName" error={error("displayName")}>
                  <Input
                    id="displayName"
                    name="displayName"
                    defaultValue={profile.display_name}
                    required
                    aria-invalid={Boolean(error("displayName"))}
                  />
                </Field>
                <Field label="Full name" htmlFor="fullName" hint="Optional." error={error("fullName")}>
                  <Input id="fullName" name="fullName" defaultValue={profile.full_name ?? ""} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Country"
                    htmlFor="countryCode"
                    hint="Two-letter code, e.g. US."
                    error={error("countryCode")}
                  >
                    <Input
                      id="countryCode"
                      name="countryCode"
                      maxLength={2}
                      defaultValue={profile.country_code ?? ""}
                      className="uppercase"
                    />
                  </Field>
                  <Field label="Time zone" htmlFor="timezone" error={error("timezone")}>
                    <Input id="timezone" name="timezone" defaultValue={profile.timezone} />
                  </Field>
                </div>
              </>
            ) : null}

            {step === "persona" ? (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-ink-muted">How will you use BTG?</legend>
                  {SELECTABLE_PERSONAS.map((persona) => (
                    <label
                      key={persona}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06] has-[:checked]:border-brand/50 has-[:checked]:bg-brand/10"
                    >
                      <input
                        type="radio"
                        name="primaryPersona"
                        value={persona}
                        defaultChecked={profile.primary_persona === persona}
                        className="mt-1 accent-[var(--color-brand)]"
                        required
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink">{PERSONA_LABELS[persona]}</span>
                        <span className="block text-xs text-ink-subtle">{PERSONA_INTENT_COPY[persona]}</span>
                      </span>
                    </label>
                  ))}
                  {error("primaryPersona") ? (
                    <p role="alert" className="text-xs text-danger">
                      {error("primaryPersona")}
                    </p>
                  ) : null}
                </fieldset>
                <Field
                  label="Headline"
                  htmlFor="headline"
                  hint="Optional — one line about where you are right now."
                  error={error("headline")}
                >
                  <Input id="headline" name="headline" defaultValue={profile.headline ?? ""} />
                </Field>
                <Alert tone="info">
                  Organization roles still need an invitation from that organization before they unlock
                  anything.
                </Alert>
              </>
            ) : null}

            {step === "goals" ? (
              <>
                <Field
                  label="Your main goal"
                  htmlFor="primaryGoal"
                  hint="What should be true in six months?"
                  error={error("primaryGoal")}
                >
                  <Input
                    id="primaryGoal"
                    name="primaryGoal"
                    required
                    defaultValue={learnerProfile?.primary_goal ?? ""}
                    placeholder="Land a backend engineering internship"
                    aria-invalid={Boolean(error("primaryGoal"))}
                  />
                </Field>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-ink-muted">Focus areas</legend>
                  <div className="flex flex-wrap gap-2">
                    {FOCUS_AREA_SUGGESTIONS.map((area) => (
                      <label
                        key={area}
                        className="cursor-pointer rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-white/[0.07] has-[:checked]:border-accent/50 has-[:checked]:bg-accent/15 has-[:checked]:text-ink"
                      >
                        <input
                          type="checkbox"
                          name="focusAreas"
                          value={area}
                          defaultChecked={learnerProfile?.focus_areas?.includes(area)}
                          className="sr-only"
                        />
                        {area}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Experience level" htmlFor="experienceLevel" error={error("experienceLevel")}>
                    <Select
                      id="experienceLevel"
                      name="experienceLevel"
                      defaultValue={learnerProfile?.experience_level ?? "beginner"}
                    >
                      <option value="beginner">Beginner</option>
                      <option value="developing">Developing</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </Select>
                  </Field>
                  <Field label="Hours per week" htmlFor="weeklyHours" error={error("weeklyHours")}>
                    <Input
                      id="weeklyHours"
                      name="weeklyHours"
                      type="number"
                      min={1}
                      max={60}
                      required
                      defaultValue={learnerProfile?.weekly_hours ?? 5}
                      aria-invalid={Boolean(error("weeklyHours"))}
                    />
                  </Field>
                </div>
                <Field
                  label="Target outcome"
                  htmlFor="targetOutcome"
                  hint="Optional — the specific role, program or result you're aiming at."
                  error={error("targetOutcome")}
                >
                  <Textarea
                    id="targetOutcome"
                    name="targetOutcome"
                    defaultValue={learnerProfile?.target_outcome ?? ""}
                  />
                </Field>
              </>
            ) : null}

            {step === "consent" ? (
              <>
                <ConsentCheck
                  name="terms"
                  label="I accept the BTG AI terms of use."
                  error={error("terms")}
                  required
                />
                <ConsentCheck
                  name="privacy"
                  label="I accept the privacy notice covering how my learning data is stored."
                  error={error("privacy")}
                  required
                />
                <ConsentCheck
                  name="aiProcessing"
                  label="I agree to AI-assisted personalization of my pathway and tutoring."
                  hint="Your tutor explains and questions. It never submits graded work for you."
                  error={error("aiProcessing")}
                  required
                />
                <ConsentCheck
                  name="evidenceSharing"
                  label="Share my verified evidence with employers I apply to."
                  hint="Optional, and you can change it later."
                />
                <ConsentCheck name="marketing" label="Send me product updates." hint="Optional." />
              </>
            ) : null}

            <SubmitButton className="w-full" pendingLabel="Saving…">
              {step === "consent" ? "Finish and open my dashboard" : "Continue"}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ConsentCheck({
  name,
  label,
  hint,
  error,
  required,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06] has-[:checked]:border-brand/40 has-[:checked]:bg-brand/8">
        <input
          type="checkbox"
          name={name}
          className="mt-0.5 size-4 accent-[var(--color-brand)]"
          aria-invalid={Boolean(error)}
          aria-describedby={hint ? `${name}-hint` : undefined}
        />
        <span>
          <span className="block text-sm text-ink">
            {label}
            {required ? <span className="text-danger"> *</span> : null}
          </span>
          {hint ? (
            <span id={`${name}-hint`} className="block text-xs text-ink-subtle">
              {hint}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
