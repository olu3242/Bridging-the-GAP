/**
 * Hand-authored database contract for the W01 surface. Mirrors
 * supabase/migrations; regenerate with `supabase gen types` once the project is
 * linked, and keep the shapes below as the reviewed source of truth until then.
 */
import type { Persona } from "@/domain/identity/persona";
import type {
  GrantStatus,
  MembershipStatus,
  OnboardingState,
  OrganizationStatus,
} from "@/domain/identity/lifecycle";

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface ProfileRow {
  id: string;
  display_name: string;
  full_name: string | null;
  headline: string | null;
  avatar_url: string | null;
  country_code: string | null;
  timezone: string;
  locale: string;
  primary_persona: Persona;
  onboarding_state: OnboardingState;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  type: "institution" | "employer" | "sponsor" | "platform";
  status: OrganizationStatus;
  website: string | null;
  country_code: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface MembershipRow {
  id: string;
  organization_id: string;
  profile_id: string;
  persona: Persona;
  status: MembershipStatus;
  title: string | null;
  invited_by: string | null;
  invited_at: string;
  activated_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonaGrantRow {
  id: string;
  profile_id: string;
  persona: Persona;
  status: GrantStatus;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
}

export interface LearnerProfileRow {
  profile_id: string;
  primary_goal: string;
  focus_areas: string[];
  experience_level: "beginner" | "developing" | "intermediate" | "advanced";
  weekly_hours: number;
  target_outcome: string | null;
  education_stage: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsentRow {
  id: string;
  profile_id: string;
  consent_type: "terms" | "privacy" | "ai_processing" | "evidence_sharing" | "marketing";
  policy_version: string;
  granted: boolean;
  granted_at: string;
  revoked_at: string | null;
  source: string;
}

export interface NotificationRow {
  id: string;
  profile_id: string;
  organization_id: string | null;
  channel: "in_app" | "email" | "push";
  status: "pending" | "sent" | "read" | "failed";
  category: string;
  title: string;
  body: string | null;
  action_url: string | null;
  payload: Json;
  dedupe_key: string;
  created_at: string;
  sent_at: string | null;
  read_at: string | null;
}

export interface AuditEventRow {
  id: string;
  occurred_at: string;
  actor_profile_id: string | null;
  actor_persona: Persona | null;
  organization_id: string | null;
  action: string;
  object_type: string;
  object_id: string | null;
  before: Json | null;
  after: Json | null;
  severity: "info" | "notice" | "warning" | "critical";
  correlation_id: string | null;
  workflow: string | null;
  policy_version: string | null;
  metadata: Json;
}

// ---------------------------------------------------------------- W02 — E3/E4 ---

export interface CompetencyRow {
  id: string;
  domain_id: string;
  slug: string;
  name: string;
  description: string | null;
  target_level: number;
  evidence_requirement: string | null;
  is_technical: boolean;
  sort_order: number;
}

export interface DiagnosticRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  version: number;
  is_baseline: boolean;
  max_questions: number;
}

export interface DiagnosticAttemptRow {
  id: string;
  diagnostic_id: string;
  profile_id: string;
  status: "in_progress" | "submitted" | "scored" | "abandoned";
  answered_count: number;
  question_budget: number;
  started_at: string;
  submitted_at: string | null;
  scored_at: string | null;
  abandoned_at: string | null;
  result: AttemptResult | null;
}

export interface AttemptResult {
  answered: number;
  competencies: Array<{
    competency_id: string;
    slug: string;
    name: string;
    level: number;
    target_level: number;
    asked: number;
    correct: number;
  }>;
}

/** Shape returned by public.next_diagnostic_question. Carries no answer key. */
export interface NextQuestionRow {
  question_id: string;
  competency_id: string;
  competency_name: string;
  domain_name: string;
  level: number;
  kind: "single_choice" | "multi_choice" | "self_report";
  prompt: string;
  options: Array<{ id: string; label: string }>;
  asked_ordinal: number;
  total_expected: number;
}

export interface LearnerCompetencyGapRow {
  profile_id: string;
  competency_id: string;
  slug: string;
  name: string;
  description: string | null;
  domain_name: string;
  domain_slug: string;
  level: number;
  target_level: number;
  gap: number;
  confidence: number;
  source: "baseline" | "assessment" | "evidence" | "review";
  measured_at: string;
  level_label: string | null;
  level_descriptor: string | null;
  unmet_prerequisites: string[];
}

// ------------------------------------------------------------- W03/W04 — E5/E6 ---

export interface PathwayRow {
  id: string;
  profile_id: string;
  version: number;
  status: "draft" | "active" | "superseded" | "archived";
  generated_from_attempt_id: string | null;
  rationale: { source?: string; ordering?: string; steps?: number; note?: string };
  generated_at: string;
  activated_at: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
}

export interface PathwayStepViewRow {
  id: string;
  pathway_id: string;
  profile_id: string;
  position: number;
  status: "locked" | "available" | "in_progress" | "completed" | "skipped";
  from_level: number;
  target_level: number;
  rationale: string;
  depth: number;
  unlocked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  competency_id: string;
  competency_slug: string;
  competency_name: string;
  evidence_requirement: string | null;
  domain_name: string;
  blocked_by: string[];
}

export interface LearnerModuleRow {
  profile_id: string;
  module_id: string;
  pathway_step_id: string | null;
  status: "locked" | "available" | "in_progress" | "completed";
  activities_completed: number;
  activities_total: number;
  started_at: string | null;
  completed_at: string | null;
  module_slug: string;
  module_title: string;
  summary: string | null;
  estimated_minutes: number;
  target_level: number;
  competency_id: string;
  competency_name: string;
  competency_slug: string;
  step_position: number | null;
  step_status: string | null;
}

export interface LearningActivityRow {
  id: string;
  slug: string;
  title: string;
  kind: "lesson" | "lab" | "quiz" | "reading";
  body: string;
  requires_output: boolean;
  estimated_minutes: number;
  sort_order: number;
}

// ----------------------------------------------- W05–W08 — E8/E9/E10/E11/E12 ---

export interface ProjectBriefRow {
  id: string;
  slug: string;
  competency_id: string;
  organization_id: string | null;
  kind: "project" | "challenge";
  title: string;
  brief: string;
  target_level: number;
  expected_evidence: string;
  estimated_hours: number;
}

export interface ProjectRow {
  id: string;
  brief_id: string;
  profile_id: string;
  competency_id: string;
  pathway_step_id: string | null;
  status:
    | "assigned"
    | "started"
    | "submitted"
    | "under_review"
    | "revision_required"
    | "completed"
    | "withdrawn";
  attempt: number;
  assigned_at: string;
  submitted_at: string | null;
  completed_at: string | null;
}

export interface EvidenceRow {
  id: string;
  project_id: string;
  profile_id: string;
  competency_id: string;
  rubric_id: string;
  version: number;
  status: "draft" | "submitted" | "under_review" | "accepted" | "rejected" | "superseded";
  summary: string;
  artifact_url: string | null;
  ai_assistance_declared: boolean;
  ai_assistance_note: string | null;
  submitted_at: string;
  superseded_by: string | null;
}

export interface RubricCriterionRow {
  id: string;
  rubric_id: string;
  code: string;
  label: string;
  descriptor: string;
  weight: number;
  is_required: boolean;
  sort_order: number;
}

export interface ReviewAssignmentRow {
  id: string;
  evidence_id: string;
  reviewer_profile_id: string | null;
  status: "pending" | "in_review" | "approved" | "rejected" | "revision_required";
  assigned_at: string;
  claimed_at: string | null;
  decided_at: string | null;
  rationale: string | null;
}

export interface PortfolioRow {
  verified_skill_id: string;
  profile_id: string;
  level: number;
  verified_at: string;
  revoked_at: string | null;
  competency_slug: string;
  competency_name: string;
  domain_name: string;
  evidence_id: string;
  evidence_version: number;
  evidence_summary: string;
  artifact_url: string | null;
  ai_assistance_declared: boolean;
  review_id: string;
  reviewer_rationale: string | null;
  decided_at: string | null;
  reviewer_name: string;
  project_id: string;
  project_title: string;
  project_slug: string;
}

export interface CredentialRow {
  id: string;
  profile_id: string;
  slug: string;
  title: string;
  version: number;
  status: "issued" | "revoked" | "expired";
  criteria: { required_competencies?: string[]; min_level?: number };
  issuance_basis: { verified_skill_ids?: string[]; issued_by?: string };
  issued_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
}
