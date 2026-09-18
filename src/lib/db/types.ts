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
