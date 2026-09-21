"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { AuthDivider, GoogleAuthButton } from "./google-button";
import { authErrorCopy } from "@/domain/identity/auth-errors";
import { BRAND, BRAND_ROUTES } from "@/components/brand/brand";
import { idleState, type ActionState } from "@/server/actions/action-result";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Codes arrive on `?error=` from the OAuth callback, the email-confirmation
 * callback and the session proxy. They render as one branded state here rather
 * than leaking a provider string into the page.
 */
function CallbackError({ code }: { code?: string }) {
  const copy = authErrorCopy(code);
  if (!copy) return null;
  return (
    <Alert tone={copy.retryable ? "info" : "error"} title={copy.title}>
      {copy.message}
    </Alert>
  );
}

export function JoinForm({
  action,
  googleAction,
  intent,
  errorCode,
}: {
  action: Action;
  googleAction: Action;
  intent?: string;
  errorCode?: string;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your {BRAND.wordmark.lead} account</CardTitle>
        <CardDescription>
          One account for your pathway, your projects and the proof they produce.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <CallbackError code={errorCode} />

        {/* Google first: it is the shortest route to a provisioned account. */}
        <GoogleAuthButton action={googleAction} label="Continue with Google" />
        <AuthDivider label="or sign up with email" />

        {state.status === "success" ? (
          <Alert tone="success" title="Check your inbox">
            {state.message}
          </Alert>
        ) : null}

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
            <Link href={BRAND_ROUTES.signIn} className="text-accent underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function SignInForm({
  action,
  googleAction,
  next,
  errorCode,
}: {
  action: Action;
  googleAction: Action;
  next?: string;
  errorCode?: string;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Pick up your pathway where you left it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <CallbackError code={errorCode} />

        <GoogleAuthButton action={googleAction} next={next} label="Continue with Google" />
        <AuthDivider label="or use your email" />

        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="next" value={next ?? BRAND_ROUTES.dashboard} />
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
          <div className="flex justify-end">
            <Link
              href={BRAND_ROUTES.forgotPassword}
              className="text-sm text-ink-subtle underline-offset-4 hover:text-accent hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
          <SubmitButton className="w-full" pendingLabel="Signing you in…">
            Sign in
          </SubmitButton>
          <p className="text-center text-sm text-ink-subtle">
            New to {BRAND.wordmark.lead}?{" "}
            <Link href={BRAND_ROUTES.join} className="text-accent underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function ForgotPasswordForm({ action, errorCode }: { action: Action; errorCode?: string }) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          We&apos;ll email you a link that signs you in once so you can set a new password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CallbackError code={errorCode} />
        {state.status === "success" ? (
          <Alert tone="success" title="Check your inbox">
            {state.message}
          </Alert>
        ) : null}
        {state.status === "error" && !state.fieldErrors ? (
          <Alert tone="error">{state.message}</Alert>
        ) : null}
        <form action={formAction} className="space-y-4" noValidate>
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
          <SubmitButton className="w-full" pendingLabel="Sending your link…">
            Email me a reset link
          </SubmitButton>
          <p className="text-center text-sm text-ink-subtle">
            Remembered it?{" "}
            <Link href={BRAND_ROUTES.signIn} className="text-accent underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function ResetPasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>
          This finishes the reset and signs you in on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "error" && !state.fieldErrors ? (
          <Alert tone="error">{state.message}</Alert>
        ) : null}
        <form action={formAction} className="space-y-4" noValidate>
          <Field
            label="New password"
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
          <Field
            label="Confirm new password"
            htmlFor="confirmPassword"
            error={state.fieldErrors?.confirmPassword}
          >
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Saving your password…">
            Save password
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
