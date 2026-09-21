/**
 * Auth failure codes and the branded copy they resolve to.
 *
 * Supabase and the OAuth provider both fail in ways the visitor can do
 * something about (cancelled consent, expired link) and ways they cannot
 * (provider misconfiguration). Both arrive as a redirect back onto the auth
 * surface, so the codes are enumerated here and rendered as one branded state
 * rather than leaking a provider string into the UI.
 */
export const AUTH_ERROR_CODES = [
  "missing_code",
  "invalid_code",
  "expired_link",
  "oauth_cancelled",
  "oauth_failed",
  "provider_disabled",
  "session_expired",
  "recovery_required",
  "config_missing",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

interface AuthErrorCopy {
  title: string;
  message: string;
  /** False when the visitor's own next action cannot fix it. */
  retryable: boolean;
}

const COPY: Record<AuthErrorCode, AuthErrorCopy> = {
  missing_code: {
    title: "That link is incomplete",
    message: "The sign-in link did not carry a confirmation code. Start again from here.",
    retryable: true,
  },
  invalid_code: {
    title: "That link has already been used",
    message:
      "Confirmation links work once. Sign in with your password, or send yourself a new link.",
    retryable: true,
  },
  expired_link: {
    title: "That link has expired",
    message: "Request a new one and open it from the same browser.",
    retryable: true,
  },
  oauth_cancelled: {
    title: "Google sign-in was cancelled",
    message: "Nothing was created. You can try Google again, or use an email and password.",
    retryable: true,
  },
  oauth_failed: {
    title: "Google could not complete sign-in",
    message:
      "Google returned an error instead of an account. Try again, or sign in with an email and password.",
    retryable: true,
  },
  provider_disabled: {
    title: "Google sign-in is not available",
    message:
      "The Google provider is not enabled for this environment yet. Use an email and password for now.",
    retryable: false,
  },
  session_expired: {
    title: "Your session expired",
    message: "Sign in again to pick up where you left off.",
    retryable: true,
  },
  recovery_required: {
    title: "Open your reset link again",
    message:
      "Setting a new password needs the link from your recovery email. Request a fresh one below.",
    retryable: true,
  },
  config_missing: {
    title: "Authentication is not configured",
    message: "This environment has no Supabase project attached, so sign-in cannot run.",
    retryable: false,
  },
};

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === "string" && (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

export function authErrorCopy(value: unknown): AuthErrorCopy | null {
  return isAuthErrorCode(value) ? COPY[value] : null;
}

/**
 * Maps what an OAuth provider actually sends back to our own codes.
 * Google reports a cancelled consent screen as `access_denied`.
 */
export function oauthErrorCode(error: string | null, description?: string | null): AuthErrorCode {
  const value = (error ?? "").toLowerCase();
  const detail = (description ?? "").toLowerCase();
  if (value === "access_denied" || detail.includes("cancel") || detail.includes("denied")) {
    return "oauth_cancelled";
  }
  if (value.includes("provider") || detail.includes("provider is not enabled")) {
    return "provider_disabled";
  }
  return "oauth_failed";
}

/** Supabase code-exchange failures that are worth telling apart. */
export function exchangeErrorCode(message: string | undefined): AuthErrorCode {
  const detail = (message ?? "").toLowerCase();
  if (detail.includes("expired")) return "expired_link";
  return "invalid_code";
}
