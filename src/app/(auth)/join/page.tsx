import type { Metadata } from "next";
import { JoinForm } from "@/components/app/auth-forms";
import { signUpAction, signInWithGoogleAction } from "@/server/actions/auth";
import { isSelectablePersona } from "@/domain/identity/onboarding";

export const metadata: Metadata = { title: "Join" };

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; error?: string }>;
}) {
  const { intent, error } = await searchParams;
  // Carried from the landing partner CTAs so onboarding can pre-select it.
  const persona = intent && isSelectablePersona(intent) ? intent : undefined;
  return (
    <JoinForm
      action={signUpAction}
      googleAction={signInWithGoogleAction}
      intent={persona}
      errorCode={error}
    />
  );
}
