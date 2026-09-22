"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { absoluteUrl, safeRedirectPath } from "@/lib/url";
import { SELECTABLE_PERSONAS } from "@/domain/identity/onboarding";
import { resolveSessionDestination } from "@/server/services/session-destination";
import { BRAND_ROUTES } from "@/components/brand/brand";
import { type ActionState, errorState, fieldErrorsFrom, successState, toActionState } from "./action-result";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(2, "Use at least 2 characters.").max(80),
  /** From /join?intent=… — the landing partner CTAs. */
  intent: z.enum(SELECTABLE_PERSONAS).optional(),
});

const emailOnlySchema = z.object({ email: z.email("Enter a valid email address.") });

const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Both passwords must match.",
  });

function requestedNext(formData: FormData): string | null {
  const raw = formData.get("next");
  if (typeof raw !== "string" || !raw) return null;
  const safe = safeRedirectPath(raw, "");
  return safe || null;
}


export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
    intent: formData.get("intent") || undefined,
  });
  if (!parsed.success) return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: {
          display_name: parsed.data.displayName,
          full_name: parsed.data.displayName,
          intended_persona: parsed.data.intent ?? null,
        },
        emailRedirectTo: absoluteUrl(BRAND_ROUTES.authCallback, await headers()),
      },
    });
    if (error) {
      return errorState(
        error.message.toLowerCase().includes("already")
          ? "An account with that email already exists. Sign in instead."
          : error.message,
        undefined,
        "CONFLICT",
      );
    }

    // With email confirmation enabled Supabase does not disclose that an
    // address is taken: it returns a user carrying no identities and no
    // session. Treat that as "we sent something" rather than as a new account,
    // which is both correct and non-enumerable.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return successState(
        "If that address can be used, we've emailed a confirmation link. Open it to finish signing in.",
      );
    }

    // Confirmation required: there is no session yet, so sending the visitor to
    // a protected route would bounce them straight back out.
    if (!data.session) {
      return successState(
        `We've emailed a confirmation link to ${parsed.data.email}. Open it to finish setting up your account.`,
      );
    }
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/", "layout");
  redirect(BRAND_ROUTES.onboarding);
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

  const requested = requestedNext(formData);
  let destination: string;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) {
      const detail = (error?.message ?? "").toLowerCase();
      if (detail.includes("not confirmed")) {
        return errorState(
          "Confirm your email first — open the link we sent you, then sign in.",
          undefined,
          "FORBIDDEN",
        );
      }
      return errorState("That email and password combination did not work.", undefined, "FORBIDDEN");
    }

    destination = await resolveSessionDestination(supabase, data.user.id, requested);
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

/**
 * Starts the Google OAuth flow.
 *
 * Run server-side on purpose: `@supabase/ssr` writes the PKCE code verifier
 * into an HTTP-only cookie here, and `/auth/callback` reads that same cookie to
 * exchange the authorization code for a session. The redirect target is built
 * from the request's own origin so localhost, production and previews each
 * come back to themselves.
 */
export async function signInWithGoogleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const next = requestedNext(formData);
  let authorizeUrl: string;

  try {
    const supabase = await createSupabaseServerClient();
    const callback = next
      ? `${BRAND_ROUTES.authCallback}?next=${encodeURIComponent(next)}`
      : BRAND_ROUTES.authCallback;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: absoluteUrl(callback, await headers()),
        // Google only returns the account's name and picture when asked.
        scopes: "openid email profile",
      },
    });

    if (error || !data?.url) {
      const detail = (error?.message ?? "").toLowerCase();
      if (detail.includes("provider") && detail.includes("not enabled")) {
        return errorState(
          "Google sign-in is not enabled for this environment yet. Use an email and password for now.",
          undefined,
          "DEPENDENCY_FAILURE",
        );
      }
      return errorState(
        "We could not reach Google just now. Try again, or use an email and password.",
        undefined,
        "DEPENDENCY_FAILURE",
      );
    }
    authorizeUrl = data.url;
  } catch (error) {
    return toActionState(error);
  }

  // Off-origin: Next needs the absolute URL, and this must be the last thing
  // the action does.
  redirect(authorizeUrl);
}

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailOnlySchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: absoluteUrl(
        `${BRAND_ROUTES.authCallback}?next=${encodeURIComponent(BRAND_ROUTES.resetPassword)}`,
        await headers(),
      ),
    });
    // A wrong address must look exactly like a right one, or this becomes an
    // account-enumeration endpoint. Only transport failures surface.
    if (error && !/user|email|not found/i.test(error.message)) {
      return errorState("We could not send that email just now. Try again shortly.", undefined, error.code);
    }
  } catch (error) {
    return toActionState(error);
  }

  return successState(
    "If that address has an account, a reset link is on its way. It expires after a short while.",
  );
}

export async function updatePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

  let destination: string;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Setting a password is only ever done from a live recovery session.
    if (!user) {
      return errorState(
        "Your reset link is no longer valid. Request a new one and open it from this browser.",
        undefined,
        "UNAUTHENTICATED",
      );
    }

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return errorState(error.message, undefined, error.code);

    destination = await resolveSessionDestination(supabase, user.id, null);
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(BRAND_ROUTES.home);
}
