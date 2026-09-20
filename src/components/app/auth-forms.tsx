"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function JoinForm({ action, intent }: { action: Action; intent?: string }) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your BTG account</CardTitle>
        <CardDescription>
          One account for your pathway, your projects and the proof they produce.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          {intent ? <input type="hidden" name="intent" value={intent} /> : null}
          {state.status === "error" && !state.fieldErrors ? (
            <Alert tone="error">{state.message}</Alert>
          ) : null}
          <Field label="Name" htmlFor="displayName" error={state.fieldErrors?.displayName}>
            <Input
              id="displayName"
              name="displayName"
              autoComplete="name"
              required
              aria-invalid={Boolean(state.fieldErrors?.displayName)}
              placeholder="Ada Okoro"
            />
          </Field>
          <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(state.fieldErrors?.email)}
              placeholder="you@example.com"
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            hint="At least 8 characters."
            error={state.fieldErrors?.password}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={Boolean(state.fieldErrors?.password)}
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Creating your account…">
            Create account
          </SubmitButton>
          <p className="text-center text-sm text-ink-subtle">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-accent underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function SignInForm({ action, next }: { action: Action; next?: string }) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Pick up your pathway where you left it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="next" value={next ?? "/dashboard"} />
          {state.status === "error" && !state.fieldErrors ? (
            <Alert tone="error">{state.message}</Alert>
          ) : null}
          <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(state.fieldErrors?.email)}
            />
          </Field>
          <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(state.fieldErrors?.password)}
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Signing you in…">
            Sign in
          </SubmitButton>
          <p className="text-center text-sm text-ink-subtle">
            New to BTG?{" "}
            <Link href="/join" className="text-accent underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
