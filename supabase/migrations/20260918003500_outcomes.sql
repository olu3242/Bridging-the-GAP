-- E17 Outcomes / Analytics.
--
-- No new store and no vendor: every number here is derived either from the
-- canonical tables that own the state or from the audit ledger that already
-- records each transition. A metric that cannot be traced to one of those is
-- not published.

-- ------------------------------------------------- project completion event ---
-- Defect closed: a project reaches 'completed' inside decide_review, so the
-- only recorded fact was 'verification.skill.verified'. The funnel needs
-- project completion as a first-class event, and it must fire wherever the
-- transition is driven from -- not only from today's one caller. The registry
-- trigger already guards which transitions are legal; this records them.
create or replace function btg.on_project_completed()
returns trigger language plpgsql security definer
set search_path = public, btg, pg_temp as $$
begin
  perform public.record_audit_event(
    'project.project.completed', 'project', new.id::text, null, null,
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status, 'competency_id', new.competency_id,
                       'attempt', new.attempt),
    'notice'::public.btg_audit_severity, null, 'verification');
  return null;
end;
$$;

drop trigger if exists projects_audit_completion on public.projects;
create trigger projects_audit_completion
after update of status on public.projects
for each row
when (new.status = 'completed' and old.status is distinct from 'completed')
execute function btg.on_project_completed();

-- ------------------------------------------------------- learner funnel ---
-- security_invoker: the underlying RLS decides whose funnel a caller can read,
-- so the view carries no authorization logic of its own. A learner sees their
-- own row; nobody sees a row they could not already assemble by hand.
create or replace view public.learner_outcome_view
with (security_invoker = true) as
select
  p.id as profile_id,
  (select count(*) from public.learner_competencies lc
    where lc.profile_id = p.id) as competencies_measured,
  (select count(*) from public.learner_competencies lc
    where lc.profile_id = p.id and lc.source = 'evidence') as competencies_from_evidence,
  (select count(*) from public.pathways pw
    where pw.profile_id = p.id and pw.status = 'active') as active_pathways,
  (select count(*) from public.pathway_steps s
    join public.pathways pw on pw.id = s.pathway_id
    where pw.profile_id = p.id and pw.status = 'active') as pathway_steps_total,
  (select count(*) from public.pathway_steps s
    join public.pathways pw on pw.id = s.pathway_id
    where pw.profile_id = p.id and pw.status = 'active'
      and s.status = 'completed') as pathway_steps_completed,
  (select count(*) from public.learner_module_progress mp
    where mp.profile_id = p.id and mp.status = 'completed') as modules_completed,
  (select count(*) from public.learner_activity_completions ac
    where ac.profile_id = p.id) as activities_completed,
  (select count(*) from public.projects pr
    where pr.profile_id = p.id) as projects_started,
  (select count(*) from public.projects pr
    where pr.profile_id = p.id and pr.status = 'completed') as projects_completed,
  (select count(*) from public.evidence e
    where e.profile_id = p.id and e.status <> 'draft') as evidence_submitted,
  (select count(*) from public.verified_skills vs
    where vs.profile_id = p.id
      and vs.revoked_at is null and vs.superseded_by is null) as skills_verified,
  (select count(*) from public.credentials c
    where c.profile_id = p.id and c.status = 'issued') as credentials_live,
  (select count(*) from public.mentorships m
    where m.learner_profile_id = p.id and m.status = 'active') as mentorships_active,
  (select count(*) from public.opportunity_matches om
    where om.profile_id = p.id) as opportunity_matches,
  (select count(*) from public.applications a
    where a.profile_id = p.id
      and a.status <> 'withdrawn') as applications_open,
  (select count(*) from public.applications a
    where a.profile_id = p.id
      and a.status in ('offered','accepted')) as offers_received,
  (select count(*) from public.applications a
    where a.profile_id = p.id and a.status = 'accepted') as offers_accepted,
  greatest(
    coalesce((select max(lc.measured_at) from public.learner_competencies lc
              where lc.profile_id = p.id), '-infinity'::timestamptz),
    coalesce((select max(ac.completed_at) from public.learner_activity_completions ac
              where ac.profile_id = p.id), '-infinity'::timestamptz),
    coalesce((select max(e.submitted_at) from public.evidence e
              where e.profile_id = p.id), '-infinity'::timestamptz),
    coalesce((select max(a.submitted_at) from public.applications a
              where a.profile_id = p.id), '-infinity'::timestamptz)
  ) as last_progress_at
from public.profiles p;

grant select on public.learner_outcome_view to authenticated, service_role;

-- ----------------------------------------------------- outcome timeline ---
-- The ledger is the source. Only the actions that represent a learner outcome
-- are surfaced, each mapped to a stable stage so a UI can order them without
-- hardcoding action strings.
create or replace view public.outcome_timeline_view
with (security_invoker = true) as
select
  a.id,
  a.actor_profile_id as profile_id,
  a.action,
  a.object_type,
  a.object_id,
  a.occurred_at,
  a.severity,
  a.after as detail,
  case a.action
    when 'identity.session.signed_up'            then 'joined'
    when 'identity.onboarding.completed'         then 'onboarded'
    when 'diagnostic.attempt.scored'             then 'baseline_measured'
    when 'pathway.pathway.generated'             then 'pathway_generated'
    when 'pathway.step.started'                  then 'step_started'
    when 'learning.module.completed'             then 'module_completed'
    when 'pathway.step.completed'                then 'step_completed'
    when 'project.project.assigned'              then 'project_assigned'
    when 'project.project.completed'             then 'project_completed'
    when 'evidence.evidence.submitted'           then 'evidence_submitted'
    when 'verification.skill.verified'           then 'skill_verified'
    when 'credential.credential.issued'          then 'credential_issued'
    when 'mentorship.mentorship.accepted'        then 'mentor_match_created'
    when 'matching.matches.computed'             then 'opportunity_match_created'
    when 'opportunity.application.submitted'     then 'opportunity_applied'
    when 'opportunity.application.shortlisted'   then 'opportunity_progressed'
    when 'opportunity.application.offered'       then 'opportunity_offered'
    when 'opportunity.application.accepted'      then 'opportunity_accepted'
  end as outcome,
  case a.action
    when 'identity.session.signed_up'            then 1
    when 'identity.onboarding.completed'         then 2
    when 'diagnostic.attempt.scored'             then 3
    when 'pathway.pathway.generated'             then 4
    when 'pathway.step.started'                  then 5
    when 'learning.module.completed'             then 6
    when 'pathway.step.completed'                then 7
    when 'project.project.assigned'              then 8
    when 'project.project.completed'             then 9
    when 'evidence.evidence.submitted'           then 10
    when 'verification.skill.verified'           then 11
    when 'credential.credential.issued'          then 12
    when 'mentorship.mentorship.accepted'        then 13
    when 'matching.matches.computed'             then 14
    when 'opportunity.application.submitted'     then 15
    when 'opportunity.application.shortlisted'   then 16
    when 'opportunity.application.offered'       then 17
    when 'opportunity.application.accepted'      then 18
  end as stage
from public.audit_events a
where a.action in (
  'identity.session.signed_up','identity.onboarding.completed','diagnostic.attempt.scored',
  'pathway.pathway.generated','pathway.step.started','learning.module.completed',
  'pathway.step.completed','project.project.assigned','project.project.completed',
  'evidence.evidence.submitted','verification.skill.verified','credential.credential.issued',
  'mentorship.mentorship.accepted','matching.matches.computed',
  'opportunity.application.submitted','opportunity.application.shortlisted',
  'opportunity.application.offered','opportunity.application.accepted');

grant select on public.outcome_timeline_view to authenticated, service_role;

-- --------------------------------------------------- cohort aggregates ---
-- An organization needs to see whether its cohort is progressing without
-- seeing any individual learner's record. Deliberately NOT a security_invoker
-- view over learner_outcome_view: that would either return silent zeros (an
-- org admin cannot read a learner's competencies) or require broad
-- cross-learner read policies, which is a privacy regression. Instead this is
-- a definer function that authorizes the caller against the cohort's
-- organization and returns aggregates only -- never a per-learner row.
create or replace function public.cohort_outcomes(p_cohort_id uuid)
returns table (
  learners bigint,
  with_baseline bigint,
  with_pathway bigint,
  with_completed_project bigint,
  with_verified_skill bigint,
  with_credential bigint,
  with_application bigint,
  with_offer bigint,
  median_skills_verified numeric
)
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;

  select organization_id into v_org from public.cohorts where id = p_cohort_id;
  if not found then raise exception 'cohort not found' using errcode = 'P0002'; end if;
  if not btg.is_org_admin(v_org) then
    raise exception 'cohort not found' using errcode = 'P0002';
  end if;

  -- A cohort of fewer than five learners is not reported: with a handful of
  -- members an aggregate identifies the individual.
  if (select count(*) from public.cohort_members where cohort_id = p_cohort_id) < 5 then
    raise exception 'a cohort needs at least 5 learners before outcomes are reported'
      using errcode = 'check_violation';
  end if;

  return query
  with members as (
    select cm.profile_id from public.cohort_members cm where cm.cohort_id = p_cohort_id
  ), per_learner as (
    select
      m.profile_id,
      (select count(*) from public.learner_competencies lc
         where lc.profile_id = m.profile_id) as competencies,
      (select count(*) from public.pathways pw
         where pw.profile_id = m.profile_id and pw.status = 'active') as pathways,
      (select count(*) from public.projects pr
         where pr.profile_id = m.profile_id and pr.status = 'completed') as projects,
      (select count(*) from public.verified_skills vs
         where vs.profile_id = m.profile_id
           and vs.revoked_at is null and vs.superseded_by is null) as skills,
      (select count(*) from public.credentials c
         where c.profile_id = m.profile_id and c.status = 'issued') as credentials,
      (select count(*) from public.applications a
         where a.profile_id = m.profile_id) as applications,
      (select count(*) from public.applications a
         where a.profile_id = m.profile_id
           and a.status in ('offered','accepted')) as offers
    from members m
  )
  select
    count(*)::bigint,
    count(*) filter (where competencies > 0)::bigint,
    count(*) filter (where pathways > 0)::bigint,
    count(*) filter (where projects > 0)::bigint,
    count(*) filter (where skills > 0)::bigint,
    count(*) filter (where credentials > 0)::bigint,
    count(*) filter (where applications > 0)::bigint,
    count(*) filter (where offers > 0)::bigint,
    percentile_cont(0.5) within group (order by skills)::numeric
  from per_learner;
end;
$$;

revoke all on function public.cohort_outcomes(uuid) from public;
grant execute on function public.cohort_outcomes(uuid) to authenticated, service_role;
