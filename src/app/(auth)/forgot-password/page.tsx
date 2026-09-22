import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/app/auth-forms";
import { requestPasswordResetAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <ForgotPasswordForm action={requestPasswordResetAction} errorCode={error} />;
}
