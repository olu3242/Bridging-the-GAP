import { OUTCOME_STAGES, type OutcomeStage } from "@/lib/db/types";

/**
 * The learner-facing name for each canonical lifecycle outcome. The ordering is
 * the database's `stage` column, not this file, so a UI can never disagree with
 * the ledger about what happened first.
 */
export const OUTCOME_LABELS: Record<OutcomeStage, string> = {
  joined: "Joined BTG",
  onboarded: "Finished onboarding",
  baseline_measured: "Baseline measured",
  pathway_generated: "Pathway generated",
  step_started: "Started a pathway step",
  module_completed: "Completed a learning module",
  step_completed: "Completed a pathway step",
  project_assigned: "Took on a project",
  project_completed: "Completed a project",
  evidence_submitted: "Submitted evidence",
  skill_verified: "Had a skill verified",
  credential_issued: "Earned a credential",
  mentor_match_created: "Matched with a mentor",
  opportunity_match_created: "Matched to opportunities",
  opportunity_applied: "Applied to an opportunity",
  opportunity_progressed: "Shortlisted",
  opportunity_offered: "Received an offer",
  opportunity_accepted: "Accepted an offer",
};

/** The funnel the dashboard reports, in the order a learner moves through it. */
export const FUNNEL_STEPS = [
  { key: "baseline_measured", label: "Baseline", field: "competencies_measured" },
  { key: "pathway_generated", label: "Pathway", field: "pathway_steps_total" },
  { key: "step_completed", label: "Steps done", field: "pathway_steps_completed" },
  { key: "project_completed", label: "Projects", field: "projects_completed" },
  { key: "evidence_submitted", label: "Evidence", field: "evidence_submitted" },
  { key: "skill_verified", label: "Skills verified", field: "skills_verified" },
  { key: "credential_issued", label: "Credentials", field: "credentials_live" },
  { key: "opportunity_applied", label: "Applications", field: "applications_open" },
  { key: "opportunity_offered", label: "Offers", field: "offers_received" },
] as const;

export function stageOrdinal(stage: OutcomeStage): number {
  return OUTCOME_STAGES.indexOf(stage) + 1;
}

/**
 * The furthest stage a learner has actually reached, from ledger rows only.
 * Absent evidence it returns null rather than guessing a stage.
 */
export function furthestStage(stages: readonly OutcomeStage[]): OutcomeStage | null {
  let best: OutcomeStage | null = null;
  for (const stage of stages) {
    if (best === null || stageOrdinal(stage) > stageOrdinal(best)) best = stage;
  }
  return best;
}
