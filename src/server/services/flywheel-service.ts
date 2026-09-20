import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";

export interface FundingProgram { id:string; name:string; kind:string; currency:string; policy_version:string }
export interface EligibilityAssessment { id:string; program_id:string; decision:"eligible"|"ineligible"|"review"; policy_version:string; assessed_at:string }
export interface FundedSeat { id:string; status:string; currency:string; cost_minor:number; activated_at:string|null }
export interface ContributionTask { id:string; title:string; instructions:string; status:string; due_at:string|null; assignee_id:string|null }
export interface ImpactEvent { id:string; event_type:string; source_type:string; source_id:string; occurred_at:string }
export interface Challenge { id:string; status:string; problem_statement:string; requirements:Record<string,unknown>; project_brief_id:string }
export interface CapabilityFact { profile_id:string; competency_id:string; competency_name:string; verified_level:number; evidence_id:string; verified_at:string; freshness:string }

export async function getAccessWorkspace(supabase:SupabaseClient, profileId:string) {
  const [programs,assessments,seats,waitlist] = await Promise.all([
    supabase.from("funding_programs").select("id,name,kind,currency,policy_version").eq("status","active").order("name"),
    supabase.from("eligibility_assessments").select("id,program_id,decision,policy_version,assessed_at").eq("profile_id",profileId).is("superseded_at",null),
    supabase.from("funded_seats").select("id,status,currency,cost_minor,activated_at").eq("profile_id",profileId),
    supabase.from("funding_waitlist").select("id,program_id,status,offer_expires_at").eq("profile_id",profileId),
  ]);
  const error=programs.error??assessments.error??seats.error??waitlist.error;
  if(error) throw fromPostgresError(error,"We could not load funding access.");
  return {programs:(programs.data??[]) as FundingProgram[],assessments:(assessments.data??[]) as EligibilityAssessment[],seats:(seats.data??[]) as FundedSeat[],waitlist:waitlist.data??[]};
}

export async function evaluateEligibility(supabase:SupabaseClient,programId:string,evidence:Record<string,unknown>) {
  const {data,error}=await supabase.rpc("evaluate_eligibility",{p_program_id:programId,p_evidence:evidence});
  if(error) throw fromPostgresError(error,"We could not assess eligibility."); return String(data);
}
export async function joinWaitlist(supabase:SupabaseClient,programId:string,assessmentId:string) {
  const {error}=await supabase.rpc("join_funding_waitlist",{p_program_id:programId,p_assessment_id:assessmentId});
  if(error) throw fromPostgresError(error,"We could not join the waitlist.");
}
export async function activateSeat(supabase:SupabaseClient,seatId:string) {
  const {error}=await supabase.rpc("activate_funded_seat",{p_seat_id:seatId});
  if(error) throw fromPostgresError(error,"We could not activate that seat.");
}
export async function getContributionWorkspace(supabase:SupabaseClient,profileId:string) {
  const [available,mine,impact]=await Promise.all([
    supabase.from("contribution_tasks").select("id,title,instructions,status,due_at,assignee_id").eq("status","available").order("created_at"),
    supabase.from("contribution_tasks").select("id,title,instructions,status,due_at,assignee_id").eq("assignee_id",profileId).order("updated_at",{ascending:false}),
    supabase.from("impact_events").select("id,event_type,source_type,source_id,occurred_at").eq("profile_id",profileId).order("occurred_at",{ascending:false}).limit(20),
  ]);
  const error=available.error??mine.error??impact.error;
  if(error) throw fromPostgresError(error,"We could not load contribution work.");
  return {available:(available.data??[]) as ContributionTask[],mine:(mine.data??[]) as ContributionTask[],impact:(impact.data??[]) as ImpactEvent[]};
}
export async function claimContributionTask(supabase:SupabaseClient,taskId:string) {
  const {error}=await supabase.rpc("claim_contribution_task",{p_task_id:taskId});
  if(error) throw fromPostgresError(error,"That task is no longer available.");
}
export async function listChallenges(supabase:SupabaseClient):Promise<Challenge[]> {
  const {data,error}=await supabase.from("challenges").select("id,status,problem_statement,requirements,project_brief_id").in("status",["published","accepting"]).order("created_at");
  if(error) throw fromPostgresError(error,"We could not load challenges."); return (data??[]) as Challenge[];
}
export async function applyToChallenge(supabase:SupabaseClient,challengeId:string) {
  const {error}=await supabase.rpc("apply_to_challenge",{p_challenge_id:challengeId});
  if(error) throw fromPostgresError(error,"We could not start that challenge.");
}
export async function getMyCapabilityGraph(supabase:SupabaseClient):Promise<CapabilityFact[]> {
  const {data,error}=await supabase.rpc("query_capability_graph",{p_organization_id:null,p_region:null});
  if(error) throw fromPostgresError(error,"We could not load the capability graph."); return (data??[]) as CapabilityFact[];
}
