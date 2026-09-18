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
