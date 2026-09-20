-- W14-G, lineage: "whose outcome is this" is not "who did it".
--
-- Defect found by the coordinator proof. A learner's own timeline never showed
-- their skill being verified, their credential being issued, their mentorship
-- being accepted or their application being shortlisted -- because
-- outcome_timeline_view keyed on actor_profile_id, and the actor of those
-- events is correctly the reviewer, the mentor or the employer. The events were
-- visible to the person who acted and invisible to the person they were about.
--
-- The fix is the mechanism W14-D already introduced for runtime actions: a
-- named subject. Two parts.
--
-- 1. A BEFORE INSERT trigger fills in metadata.subject for the ledger actions
--    whose subject is derivable from the object the row already names. It
--    changes no engine, invents no fact and never overwrites a subject a
--    command stated itself -- it writes down who an event was about, from the
--    record the event already points at.
-- 2. The timeline prefers the subject over the actor, because the timeline
--    answers "what happened to this learner", not "what did this person do".
--    An event with no subject still falls back to its actor, which is every
--    event a learner performs themselves.

create or replace function btg.stamp_outcome_subject()
returns trigger language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_subject uuid;
begin
  -- A command that stated the subject knows better than this trigger does.
  if new.metadata ? 'subject' then return new; end if;
  if new.object_id is null then return new; end if;

  begin
    case new.object_type
      when 'verified_skill' then
        select vs.profile_id into v_subject from public.verified_skills vs
        where vs.id = new.object_id::uuid;
      when 'credential' then
        select c.profile_id into v_subject from public.credentials c
        where c.id = new.object_id::uuid;
      when 'mentorship' then
        select m.learner_profile_id into v_subject from public.mentorships m
        where m.id = new.object_id::uuid;
      when 'application' then
        select a.profile_id into v_subject from public.applications a
        where a.id = new.object_id::uuid;
      when 'project' then
        select pr.profile_id into v_subject from public.projects pr
        where pr.id = new.object_id::uuid;
      when 'evidence' then
        select e.profile_id into v_subject from public.evidence e
        where e.id = new.object_id::uuid;
      when 'review' then
        select e.profile_id into v_subject
        from public.review_assignments ra
        join public.evidence e on e.id = ra.evidence_id
        where ra.id = new.object_id::uuid;
      else
        v_subject := null;
    end case;
  exception when invalid_text_representation then
    -- object_id is free-form text; a non-uuid simply has no subject to find.
    v_subject := null;
  end;

  -- Only worth recording when it is somebody other than the actor: an event a
  -- learner performed on their own record needs no subject to be found by it.
  if v_subject is not null and v_subject is distinct from new.actor_profile_id then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
                    || jsonb_build_object('subject', v_subject);
  end if;

  return new;
end;
$$;

drop trigger if exists audit_events_stamp_subject on public.audit_events;
create trigger audit_events_stamp_subject
  before insert on public.audit_events
  for each row execute function btg.stamp_outcome_subject();

/* The timeline answers "what happened to this learner". The subject wins where
   one is named; otherwise the actor is the subject, which covers every event a
   learner performs themselves.

   Dropped and recreated rather than replaced: `acted_by` is a new column in
   the middle of the list, which `create or replace view` reads as renaming an
   existing one. */
drop view if exists public.outcome_timeline_view;
create view public.outcome_timeline_view
with (security_invoker = true) as
select
  a.id,
  coalesce((a.metadata->>'subject')::uuid, a.actor_profile_id) as profile_id,
  a.action,
  a.object_type,
  a.object_id,
  a.occurred_at,
  a.severity,
  a.after as detail,
  a.actor_profile_id as acted_by,
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

revoke all on function btg.stamp_outcome_subject() from public;
revoke all on function btg.stamp_outcome_subject() from anon;
revoke all on function btg.stamp_outcome_subject() from authenticated;
grant execute on function btg.stamp_outcome_subject() to service_role;
