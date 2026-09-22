import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/app/auth-forms";
import { updatePasswordAction } from "@/server/actions/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAND_ROUTES } from "@/components/brand/brand";

export const metadata: Metadata = { title: "Set a new password" };
// A recovery session is per-request; this must never be prerendered.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reached without the recovery link (or after it expired): say so in the
  // branded recovery state rather than showing a form that cannot submit.
  if (!user) redirect(`${BRAND_ROUTES.forgotPassword}?error=recovery_required`);

  return <ResetPasswordForm action={updatePasswordAction} />;
}
