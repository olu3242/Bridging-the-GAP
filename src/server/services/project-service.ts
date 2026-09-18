import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type {
  CredentialRow,
  EvidenceRow,
  PortfolioRow,
  ProjectBriefRow,
  ProjectRow,
} from "@/lib/db/types";

export async function listBriefsForCompetency(
  supabase: SupabaseClient,
  competencyId?: string,
): Promise<ProjectBriefRow[]> {
  let query = supabase.from("project_briefs").select("*").eq("status", "published");
  if (competencyId) query = query.eq("competency_id", competencyId);
  const { data, error } = await query.order("target_level", { ascending: true });
  if (error) throw fromPostgresError(error, "We could not load the project briefs.");
  return (data ?? []) as ProjectBriefRow[];
}

export async function listProjects(supabase: SupabaseClient, profileId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*, project_briefs(slug, title, kind, target_level, expected_evidence), competencies(name, slug)")
    .eq("profile_id", profileId)
    .order("assigned_at", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load your projects.");
  return data ?? [];
}

export async function assignProject(
  supabase: SupabaseClient,
  briefSlug: string,
  stepId?: string,
): Promise<ProjectRow> {
  const { data, error } = await supabase.rpc("assign_project", {
    p_brief_slug: briefSlug,
    p_step_id: stepId ?? null,
  });
  if (error) throw fromPostgresError(error, "We could not start that project.");
  return data as ProjectRow;
}

export async function submitEvidence(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    summary: string;
    artifactUrl?: string;
    aiDeclared: boolean;
    aiNote?: string;
  },
): Promise<EvidenceRow> {
  const { data, error } = await supabase.rpc("submit_evidence", {
    p_project_id: input.projectId,
    p_summary: input.summary,
    p_artifact_url: input.artifactUrl || null,
    p_ai_declared: input.aiDeclared,
    p_ai_note: input.aiNote || null,
  });
  if (error) throw fromPostgresError(error, "We could not submit your evidence.");
  return data as EvidenceRow;
}

export async function getProject(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*, project_briefs(*), competencies(name, slug)")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not load that project.");
  return data;
}

export async function getProjectEvidence(
  supabase: SupabaseClient,
  projectId: string,
): Promise<EvidenceRow[]> {
  const { data, error } = await supabase
    .from("evidence")
    .select("*")
    .eq("project_id", projectId)
    .order("version", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load your submissions.");
  return (data ?? []) as EvidenceRow[];
}

/** Reviews of the learner's own evidence, so they can see the decision. */
export async function getEvidenceReviews(supabase: SupabaseClient, evidenceIds: string[]) {
  if (evidenceIds.length === 0) return [];
  const { data, error } = await supabase
    .from("review_assignments")
    .select("id, evidence_id, status, decided_at, rationale")
    .in("evidence_id", evidenceIds);
  if (error) throw fromPostgresError(error, "We could not load the review outcome.");
  return data ?? [];
}

export async function getPortfolio(
  supabase: SupabaseClient,
  profileId: string,
): Promise<PortfolioRow[]> {
  const { data, error } = await supabase
    .from("portfolio_view")
    .select("*")
    .eq("profile_id", profileId)
    .is("revoked_at", null)
    .order("verified_at", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load your portfolio.");
  return (data ?? []) as PortfolioRow[];
}

export async function getCredentials(
  supabase: SupabaseClient,
  profileId: string,
): Promise<CredentialRow[]> {
  const { data, error } = await supabase
    .from("credentials")
    .select("*")
    .eq("profile_id", profileId)
    .order("issued_at", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load your credentials.");
  return (data ?? []) as CredentialRow[];
}
