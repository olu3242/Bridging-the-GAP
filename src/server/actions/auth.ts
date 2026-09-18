"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { type ActionState, errorState, fieldErrorsFrom, toActionState } from "./action-result";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(2, "Use at least 2 characters.").max(80),
});

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Only same-origin paths; never bounce a signed-in learner off-site.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) return errorState("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { display_name: parsed.data.displayName },
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

  const next = safeNext(formData.get("next"));

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return errorState("That email and password combination did not work.", undefined, "FORBIDDEN");
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
