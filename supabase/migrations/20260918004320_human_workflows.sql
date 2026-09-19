-- W14-E — the three workflows that are actually about people.
--
-- Each one waits for a learner's own action, then parks a human step for the
-- persona that owns the decision, then waits for the domain result the
-- governed engine command produces. The workflow never decides anything.

insert into btg.workflow_checks (name, requires_subject_type, description) values
  ('evidence_submitted_for_review', 'evidence',
   'The subject''s evidence has left draft and is awaiting or under review.'),
  ('evidence_reviewed', 'evidence',
   'A reviewer recorded a decision on that evidence through decide_review.'),
  ('evidence_verified', 'evidence',
   'A live verified skill exists that cites that evidence.'),
  ('mentorship_requested', 'mentorship',
   'The subject has an outstanding mentorship request.'),
  ('mentorship_answered', 'mentorship',
   'The mentor answered: accepted, declined or ended.'),
  ('application_submitted', 'application',
   'The subject has submitted that application.'),
  ('application_decided', 'application',
   'The organization moved that application past submitted, or the learner answered an offer.')
on conflict (name) do update set
  requires_subject_type = excluded.requires_subject_type,
  description = excluded.description;

create or replace function btg.assert_step_satisfied(
  p_check text,
  p_subject_type text,
  p_subject_id uuid,
  p_profile uuid
)
returns boolean language plpgsql stable security definer
set search_path = public, btg, pg_temp as $$
declare
  v_required text;
  v_ok boolean := false;
begin
  select requires_subject_type into v_required from btg.workflow_checks where name = p_check;
  if not found then
    raise exception 'unknown completion check %', p_check using errcode = '42501';
  end if;
  if v_required is not null and coalesce(p_subject_type, '') <> v_required then
    raise exception 'check % needs a % subject, got %',
      p_check, v_required, coalesce(p_subject_type, 'none')
      using errcode = 'check_violation';
  end if;

  /* Every branch scopes to the instance's own subject as well as the entity,
     so a work item pointed at somebody else's record finds nothing rather
     than reading across a boundary. */
  case p_check
    when 'diagnostic_attempt_started' then
      select exists (
        select 1 from public.diagnostic_attempts a
        where a.id = p_subject_id and a.profile_id = p_profile) into v_ok;
    when 'diagnostic_attempt_scored' then
      select exists (
        select 1 from public.diagnostic_attempts a
        where a.id = p_subject_id and a.profile_id = p_profile
          and a.status = 'scored') into v_ok;
    when 'learner_baseline_recorded' then
      select exists (
        select 1 from public.learner_competencies lc
        where lc.profile_id = p_profile and lc.source = 'baseline') into v_ok;
    when 'learner_has_verified_skill' then
      select exists (
        select 1 from public.verified_skills vs
        where vs.profile_id = p_profile
          and vs.revoked_at is null and vs.superseded_by is null) into v_ok;
    when 'learner_has_opportunity_match' then
      select exists (
        select 1 from public.opportunity_matches om
        where om.profile_id = p_profile) into v_ok;
    when 'learner_has_active_pathway' then
      select exists (
        select 1 from public.pathways p
        where p.profile_id = p_profile and p.status = 'active') into v_ok;

    when 'evidence_submitted_for_review' then
      select exists (
        select 1 from public.evidence e
        where e.id = p_subject_id and e.profile_id = p_profile
          and e.status in ('submitted','under_review','accepted','rejected')) into v_ok;
    when 'evidence_reviewed' then
      select exists (
        select 1 from public.review_assignments ra
        join public.evidence e on e.id = ra.evidence_id
        where ra.evidence_id = p_subject_id and e.profile_id = p_profile
          and ra.status in ('approved','rejected','revision_required')) into v_ok;
    when 'evidence_verified' then
      select exists (
        select 1 from public.verified_skills vs
        where vs.evidence_id = p_subject_id and vs.profile_id = p_profile
          and vs.revoked_at is null and vs.superseded_by is null) into v_ok;

    when 'mentorship_requested' then
      select exists (
        select 1 from public.mentorships m
        where m.id = p_subject_id and m.learner_profile_id = p_profile
          and m.status = 'requested') into v_ok;
    when 'mentorship_answered' then
      select exists (
        select 1 from public.mentorships m
        where m.id = p_subject_id and m.learner_profile_id = p_profile
          and m.status in ('accepted','declined','active','completed','ended')) into v_ok;

    when 'application_submitted' then
      select exists (
        select 1 from public.applications a
        where a.id = p_subject_id and a.profile_id = p_profile
          and a.status <> 'draft') into v_ok;
    when 'application_decided' then
      select exists (
        select 1 from public.applications a
        where a.id = p_subject_id and a.profile_id = p_profile
          and a.status in ('under_review','shortlisted','offered','rejected',
                           'accepted','withdrawn')) into v_ok;
    else
      raise exception 'completion check % is registered but not implemented', p_check
        using errcode = '42501';
  end case;

  return v_ok;
end;
$$;

revoke all on function btg.assert_step_satisfied(text, text, uuid, uuid) from public;
revoke all on function btg.assert_step_satisfied(text, text, uuid, uuid) from anon;
revoke all on function btg.assert_step_satisfied(text, text, uuid, uuid) from authenticated;
grant execute on function btg.assert_step_satisfied(text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------- definitions ---
do $$
declare v_def uuid; v_version uuid;
begin
  -- verification: evidence -> a reviewer's decision -> a verified skill.
  select id into v_def from public.workflow_definitions where key = 'verification';
  if not exists (select 1 from public.workflow_definition_versions
                 where definition_id = v_def and status = 'published') then
    insert into public.workflow_definition_versions (definition_id, notes)
    values (v_def, 'W14-E: submitted evidence, a reviewer decision, then the verified skill the engine produced.')
    returning id into v_version;

    insert into public.workflow_definition_steps (
      definition_version_id, step_key, ordinal, item_type, handler,
      completion_check, owner_kind, owner_persona, sla_hours, priority, audit_workflow
    ) values
      (v_version, 'evidence_submitted', 1, 'system', 'await_domain_state',
       'evidence_submitted_for_review', 'system', null, null, 100, 'evidence'),
      (v_version, 'reviewer_decision', 2, 'human', 'human_review',
       'evidence_reviewed', 'persona', 'reviewer', 48, 50, 'verification'),
      (v_version, 'skill_verified', 3, 'system', 'await_domain_state',
       'evidence_verified', 'system', null, null, 100, 'verification');

    perform btg.publish_definition_version(v_version);
  end if;
  update public.workflow_definitions set is_enabled = true, is_self_startable = true
  where key = 'verification';

  -- mentorship: a learner's request -> the mentor's answer.
  select id into v_def from public.workflow_definitions where key = 'mentorship';
  if not exists (select 1 from public.workflow_definition_versions
                 where definition_id = v_def and status = 'published') then
    insert into public.workflow_definition_versions (definition_id, notes)
    values (v_def, 'W14-E: a mentorship request waiting on the mentor.')
    returning id into v_version;

    insert into public.workflow_definition_steps (
      definition_version_id, step_key, ordinal, item_type, handler,
      completion_check, owner_kind, owner_persona, sla_hours, priority, audit_workflow
    ) values
      (v_version, 'request_made', 1, 'system', 'await_domain_state',
       'mentorship_requested', 'system', null, null, 100, 'mentorship'),
      (v_version, 'mentor_answer', 2, 'human', 'human_review',
       'mentorship_answered', 'persona', 'mentor', 72, 60, 'mentorship');

    perform btg.publish_definition_version(v_version);
  end if;
  update public.workflow_definitions set is_enabled = true, is_self_startable = true
  where key = 'mentorship';

  -- opportunities: a learner's application -> the employer's decision.
  select id into v_def from public.workflow_definitions where key = 'opportunities';
  if not exists (select 1 from public.workflow_definition_versions
                 where definition_id = v_def and status = 'published') then
    insert into public.workflow_definition_versions (definition_id, notes)
    values (v_def, 'W14-E: a submitted application waiting on the hiring organization.')
    returning id into v_version;

    insert into public.workflow_definition_steps (
      definition_version_id, step_key, ordinal, item_type, handler,
      completion_check, owner_kind, owner_persona, sla_hours, priority, audit_workflow
    ) values
      (v_version, 'application_submitted', 1, 'system', 'await_domain_state',
       'application_submitted', 'system', null, null, 100, 'opportunities'),
      (v_version, 'employer_decision', 2, 'approval', 'approval',
       'application_decided', 'persona', 'employer', 120, 70, 'opportunities');

    perform btg.publish_definition_version(v_version);
  end if;
  update public.workflow_definitions set is_enabled = true, is_self_startable = true
  where key = 'opportunities';
end $$;
