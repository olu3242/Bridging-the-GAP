"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import { activateSeat,applyToChallenge,claimContributionTask,evaluateEligibility,joinWaitlist,submitContribution } from "@/server/services/flywheel-service";

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
const contributionSchema=z.object({taskId:z.uuid(),evidenceId:z.uuid(),source:z.string().trim().min(2).max(200),method:z.string().trim().min(2).max(500),license:z.string().trim().min(2).max(120),version:z.coerce.number().int().positive(),transforms:z.string().trim().max(1000),contentHash:z.string().trim().min(8).max(200)});
export async function submitContributionAction(formData:FormData) {
 const parsed=contributionSchema.parse(Object.fromEntries(formData)); const {supabase,actor}=await requireContext(); assertCan(actor,"evidence.submit_own");
 await submitContribution(supabase,{taskId:parsed.taskId,evidenceId:parsed.evidenceId,contentHash:parsed.contentHash,provenance:{source:parsed.source,method:parsed.method,captured_at:new Date().toISOString(),license_or_consent:parsed.license,version:parsed.version,transforms:parsed.transforms}});
 revalidatePath("/contributions");
}

const fundingProgramSchema=z.object({organizationId:z.uuid(),code:z.string().trim().min(3).max(60).regex(/^[a-z0-9-]+$/),name:z.string().trim().min(3).max(160),kind:z.enum(["fund_a_seat","cohort","community","program"]),currency:z.string().length(3),policyVersion:z.string().trim().min(1).max(40),requiredKeys:z.string().trim().max(500)});
export async function createFundingProgramAction(formData:FormData){const p=fundingProgramSchema.parse(Object.fromEntries(formData));const {supabase,actor}=await requireContext();assertCan(actor,"funding.manage");const requiredKeys=p.requiredKeys.split(",").map(v=>v.trim()).filter(Boolean);const {error}=await supabase.rpc("create_funding_program",{p_organization_id:p.organizationId,p_code:p.code,p_name:p.name,p_kind:p.kind,p_currency:p.currency.toUpperCase(),p_policy_version:p.policyVersion,p_policy:{required_keys:requiredKeys}});if(error)throw error;revalidatePath("/governance");}
const contributionProgramSchema=z.object({organizationId:z.uuid(),name:z.string().trim().min(3).max(160),kind:z.enum(["data","research","localization","evaluation","digitization","community","solution"]),license:z.string().trim().max(120).optional()});
export async function createContributionProgramAction(formData:FormData){const p=contributionProgramSchema.parse(Object.fromEntries(formData));const {supabase,actor}=await requireContext();assertCan(actor,"contribution.manage");const {error}=await supabase.rpc("create_contribution_program",{p_organization_id:p.organizationId,p_name:p.name,p_kind:p.kind,p_license:p.license||null});if(error)throw error;revalidatePath("/governance");}
const taskSchema=z.object({programId:z.uuid(),title:z.string().trim().min(3).max(160),instructions:z.string().trim().min(20).max(5000)});
export async function createContributionTaskAction(formData:FormData){const p=taskSchema.parse(Object.fromEntries(formData));const {supabase,actor}=await requireContext();assertCan(actor,"contribution.manage");const {error}=await supabase.rpc("create_contribution_task",{p_program_id:p.programId,p_title:p.title,p_instructions:p.instructions,p_project_id:null,p_due_at:null});if(error)throw error;revalidatePath("/governance");revalidatePath("/contributions");}
const reviewSchema=z.object({submissionId:z.uuid(),decision:z.enum(["accepted","revision_required","rejected"]),notes:z.string().trim().min(5).max(2000)});
export async function reviewContributionAction(formData:FormData){const p=reviewSchema.parse(Object.fromEntries(formData));const {supabase,actor}=await requireContext();assertCan(actor,"contribution.manage");const {error}=await supabase.rpc("review_contribution",{p_submission_id:p.submissionId,p_decision:p.decision,p_notes:p.notes});if(error)throw error;revalidatePath("/governance");revalidatePath("/contributions");}
const reconcileSchema=z.object({commitmentId:z.uuid(),providerReference:z.string().trim().min(3).max(200),success:z.enum(["true","false"])});
export async function reconcileFundingAction(formData:FormData){const p=reconcileSchema.parse(Object.fromEntries(formData));const {supabase,actor,correlationId}=await requireContext();assertCan(actor,"funding.manage");const {error}=await supabase.rpc("reconcile_funding",{p_commitment_id:p.commitmentId,p_provider_reference:p.providerReference,p_success:p.success==="true",p_idempotency_key:`reconcile:${p.commitmentId}:${correlationId}`});if(error)throw error;revalidatePath("/governance");}
