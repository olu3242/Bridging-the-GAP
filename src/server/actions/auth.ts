"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { SELECTABLE_PERSONAS } from "@/domain/identity/onboarding";
import { resolveDestination } from "@/domain/identity/journey";
import type { OnboardingState } from "@/domain/identity/lifecycle";
import type { Persona } from "@/domain/identity/persona";
import { type ActionState, errorState, fieldErrorsFrom, toActionState } from "./action-result";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(2, "Use at least 2 characters.").max(80),
  /** From /join?intent=… — the landing partner CTAs. */
  intent: z.enum(SELECTABLE_PERSONAS).optional(),
});

function safeNext(value: FormDataEntryValue | null): string | null {
  const next = typeof value === "string" ? value : "";
  // Only same-origin paths; never bounce a signed-in learner off-site.
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
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
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: {
          display_name: parsed.data.displayName,
          intended_persona: parsed.data.intent ?? null,
        },
        emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback`,
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
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/", "layout");
  redirect("/onboarding");
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

  const requested = safeNext(formData.get("next"));
  let destination: string;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) {
      return errorState("That email and password combination did not work.", undefined, "FORBIDDEN");
    }

    // Resolve from persisted state: a learner mid-onboarding goes back to
    // onboarding even if they asked for the dashboard.
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_state, baseline_completed_at, active_pathway_id, primary_persona")
      .eq("id", data.user.id)
      .maybeSingle();

    const state = {
      authenticated: true,
      onboardingState: (profile?.onboarding_state as OnboardingState) ?? "not_started",
      baselineCompleted: Boolean(profile?.baseline_completed_at),
      pathwayGenerated: Boolean(profile?.active_pathway_id),
      primaryPersona: profile?.primary_persona as Persona | undefined,
    };
    const resolved = resolveDestination(state);
    destination = resolved === "/dashboard" && requested ? requested : resolved;
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
  redirect("/");
}
