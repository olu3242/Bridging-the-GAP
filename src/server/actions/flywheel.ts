"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/server/services/actor";
import { activateSeat,applyToChallenge,claimContributionTask,evaluateEligibility,joinWaitlist } from "@/server/services/flywheel-service";

const id=z.uuid();
export async function evaluateEligibilityAction(formData:FormData) {
  const programId=id.parse(formData.get("programId"));
  const {supabase,actor}=await requireContext();
  const {data,error}=await supabase.from("profiles").select("country_code,locale").eq("id",actor.profileId).single();
  if(error) throw error;
  await evaluateEligibility(supabase,programId,{country_code:data.country_code,locale:data.locale,profile_id:actor.profileId});
  revalidatePath("/access");
}
export async function joinWaitlistAction(formData:FormData) {
  const programId=id.parse(formData.get("programId")); const assessmentId=id.parse(formData.get("assessmentId"));
  const {supabase}=await requireContext(); await joinWaitlist(supabase,programId,assessmentId); revalidatePath("/access");
}
export async function activateSeatAction(formData:FormData) {
  const seatId=id.parse(formData.get("seatId")); const {supabase}=await requireContext();
  await activateSeat(supabase,seatId); revalidatePath("/access"); revalidatePath("/outcomes");
}
export async function claimContributionTaskAction(formData:FormData) {
  const taskId=id.parse(formData.get("taskId")); const {supabase}=await requireContext();
  await claimContributionTask(supabase,taskId); revalidatePath("/contributions");
}
export async function applyToChallengeAction(formData:FormData) {
  const challengeId=id.parse(formData.get("challengeId")); const {supabase}=await requireContext();
  await applyToChallenge(supabase,challengeId); revalidatePath("/challenges"); revalidatePath("/projects");
}
