import type { Metadata } from "next";
import { JoinForm } from "@/components/app/auth-forms";
import { signUpAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Join" };

export default function JoinPage() {
  return <JoinForm action={signUpAction} />;
}
