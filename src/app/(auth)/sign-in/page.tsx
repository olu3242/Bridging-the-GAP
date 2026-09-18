import type { Metadata } from "next";
import { SignInForm } from "@/components/app/auth-forms";
import { signInAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return <SignInForm action={signInAction} next={safeNext} />;
}
