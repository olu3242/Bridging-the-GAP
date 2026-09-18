import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/app/onboarding-steps";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLearnerProfile, getProfile } from "@/server/services/onboarding-service";
import { requireActor } from "@/server/services/actor";
import { submitOnboardingStepAction } from "@/server/actions/onboarding";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const actor = await requireActor();
  const supabase = await createSupabaseServerClient();
  const profile = await getProfile(supabase, actor.profileId);
  if (!profile) redirect("/sign-in");
  if (profile.onboarding_state === "completed") redirect("/dashboard");

  const learnerProfile =
    profile.onboarding_state === "goals" ? await getLearnerProfile(supabase, actor.profileId) : null;

  return (
    <OnboardingFlow
      action={submitOnboardingStepAction}
      state={profile.onboarding_state}
      profile={profile}
      learnerProfile={learnerProfile}
    />
  );
}
