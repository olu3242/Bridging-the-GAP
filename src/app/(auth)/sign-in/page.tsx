import type { Metadata } from "next";
import { SignInForm } from "@/components/app/auth-forms";
import { signInAction, signInWithGoogleAction } from "@/server/actions/auth";
import { safeRedirectPath } from "@/lib/url";
import { BRAND_ROUTES } from "@/components/brand/brand";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <SignInForm
      action={signInAction}
      googleAction={signInWithGoogleAction}
      next={safeRedirectPath(next, BRAND_ROUTES.dashboard)}
      errorCode={error}
    />
  );
}
