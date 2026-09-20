-- CRITICAL defect, found by live certification and confirmed on the local
-- cluster too.
--
-- Postgres grants EXECUTE on every new function to the pseudo-role PUBLIC.
-- Only btg.notify ever revoked it, so every other internal btg helper was
-- callable by any authenticated session -- and `grant usage on schema btg to
-- authenticated` (migration 000100) made the schema reachable.
--
-- The worst of them, btg.complete_pathway_step, is SECURITY DEFINER with no
-- actor check because it was only ever meant to be called from inside another
-- governed command. Reachable directly, it let any learner mark ANY learner's
-- pathway step completed, bypassing the learning and verified-evidence rule
-- that the whole engine rests on. Proven by probe before this fix:
--
--   select btg.complete_pathway_step('<another learner''s step>', 'forged');
--   -> that learner's step became 'completed'
--
-- Fix: EXECUTE on the btg schema is withdrawn wholesale, then re-granted only
-- to the read-only authorization predicates that RLS policies must evaluate as
-- the calling role. Internal mutators keep no caller-facing grant at all: they
-- are invoked from definer functions, which run as the owner and need none.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'btg'
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
  end loop;
end $$;

-- The predicates RLS itself calls. Read-only, own-actor scoped, and required
-- by policies on nearly every table; without these every policy fails closed.
grant execute on function
  btg.current_profile_id(),
  btg.is_operator(),
  btg.governed_org_ids(),
  btg.has_platform_persona(public.btg_persona),
  btg.is_active_member(uuid),
  btg.has_org_persona(uuid, public.btg_persona),
  btg.is_org_admin(uuid),
  btg.is_cohort_member(uuid)
  to authenticated, service_role;

-- Supabase's managed roles need the schema itself for PostgREST introspection
-- and for definer functions to resolve btg.*; usage alone grants nothing now
-- that EXECUTE is withdrawn per function.
grant usage on schema btg to authenticated, service_role;

-- ------------------------------------------------ hosted-platform defaults ---
-- Second, narrower divergence, live only: a hosted Supabase project ships
-- default privileges that grant anon AND authenticated all seven table
-- privileges on everything created in `public`, plus EXECUTE on every
-- function. The migrations were authored against a bare cluster where
-- `authenticated` receives only what is explicitly granted, so on a hosted
-- project the layered grant+RLS defence certified locally collapses to RLS
-- alone, and diagnostic_answer_keys -- deliberately granted to nobody --
-- acquires a SELECT grant.
--
-- RLS still denied every one of those paths (no permissive policy exists for
-- anon, and the write paths have no policy at all), so nothing was exposed.
-- This restores the intended matrix so that is true by design rather than by
-- one surviving layer.

-- anon is not a participant in this product: sign-up runs through Auth, and
-- the marketing surface is static. It gets nothing.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Future objects must not re-acquire the blanket grants.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Re-assert the intended table matrix for `authenticated`. Anything not named
-- here is reachable only through a governed command.
revoke all on all tables in schema public from authenticated;

grant select on
  public.applications, public.audit_events, public.cohort_members,
  public.credential_skills, public.credentials, public.diagnostic_attempts,
  public.evidence, public.learner_activity_completions, public.learner_competencies,
  public.learner_module_progress, public.mentor_sessions, public.mentorships,
  public.opportunity_matches, public.pathway_step_dependencies, public.pathway_steps,
  public.pathways, public.projects, public.review_assignments, public.review_scores,
  public.tutor_sessions, public.tutor_turns, public.verified_skills
  to authenticated;

grant select on
  public.application_evidence_view, public.learner_competency_gaps,
  public.learner_learning_view, public.learner_outcome_view,
  public.outcome_timeline_view, public.pathway_step_view, public.portfolio_view
  to authenticated;

grant select, insert, update on
  public.consents, public.learner_profiles, public.memberships,
  public.organizations, public.persona_grants, public.profiles
  to authenticated;

grant select, update on public.notifications to authenticated;

grant select, insert, update, delete on
  public.cohorts, public.competencies, public.competency_domains,
  public.competency_levels, public.competency_prerequisites,
  public.credential_definitions, public.diagnostic_questions, public.diagnostics,
  public.file_objects, public.learning_activities, public.learning_modules,
  public.mentor_expertise, public.mentor_profiles, public.mentor_session_notes,
  public.notification_preferences, public.opportunities,
  public.opportunity_requirements, public.project_briefs, public.rubric_criteria,
  public.rubrics
  to authenticated;

-- diagnostic_responses keeps its column-level grant: a learner may see what
-- they answered, never how it was graded. RLS filters rows, not columns.
grant select (id, attempt_id, question_id, selected_option_ids, responded_at, elapsed_ms)
  on public.diagnostic_responses to authenticated;

-- diagnostic_answer_keys is named nowhere above, on purpose: it has no grant to
-- `authenticated` at all, so a valid session cannot read it even if a policy
-- were ever loosened by mistake.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
