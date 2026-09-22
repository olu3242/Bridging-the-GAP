"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/feedback";
import { idleState, type ActionState } from "@/server/actions/action-result";
import { cn } from "@/lib/utils";

/** Google's own mark, required by their branding guidelines for this button. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={cn("size-[18px] shrink-0", className)} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.1l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function GoogleSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      data-testid="google-oauth-button"
      className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-full border border-white/15 bg-white/[0.06] px-6 text-sm font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-55"
    >
      {pending ? (
        <Loader2 className="size-[18px] shrink-0 animate-spin" aria-hidden />
      ) : (
        <GoogleMark />
      )}
      {pending ? "Opening Google…" : label}
    </button>
  );
}

/**
 * The branded "Continue with Google" control.
 *
 * The action runs server-side so `@supabase/ssr` can write the PKCE code
 * verifier as an HTTP-only cookie before the browser leaves for Google; the
 * callback route reads that same cookie to exchange the code. Doing this from
 * the browser client would strand the verifier outside the server session.
 */
export function GoogleAuthButton({
  action,
  next,
  label = "Continue with Google",
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  next?: string;
  label?: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <div className={cn("space-y-3", className)}>
      {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
      <form action={formAction}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <GoogleSubmit label={label} />
      </form>
    </div>
  );
}

/** "or" rule between the Google button and the credential form. */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 rule-glow" />
      <span className="text-xs uppercase tracking-wider text-ink-subtle">{label}</span>
      <span className="h-px flex-1 rule-glow" />
    </div>
  );
}
