-- W14-G — BTG_LEARNER_TO_OPPORTUNITY.
--
-- The coordinator spans sign-up to an accepted offer. It reimplements nothing:
-- twelve of its fourteen steps are waits on state an E1-E17 engine owns, and
-- the two that act call an allowlisted system-authority command. There is no
-- reviewer step here even though verification is one of its stages -- the
-- `verification` workflow already owns the reviewer's queue, and duplicating it
-- would be a second task system for the same decision. The coordinator waits
-- for the outcome instead.
--
-- One new idea: an optional stage. A learner may never take a mentor, may
-- verify a skill without completing a full credential, and may enter through
-- evidence rather than a module. A strictly sequential run would stall forever
-- on any of those, so a step may be declared optional: when its deadline
-- passes the runtime cancels it and moves on, recording that it did. Cancelling
-- is not claiming an outcome -- it is recording that the run proceeded without
-- one, which the operator plane shows as plainly as anything else.

alter table public.workflow_definition_steps
  add column if not exists is_optional boolean not null default false;
comment on column public.workflow_definition_steps.is_optional is
  'When true, a deadline passing cancels the step and the run continues. Never used to claim an outcome.';

-- ------------------------------------------------------------ new checks ---
insert into btg.workflow_checks (name, requires_subject_type, description) values
  ('learner_profile_exists', null, 'A profile exists for the subject.'),
  ('learner_onboarded', null, 'The subject finished onboarding.'),
  ('learner_completed_a_module', null, 'The subject completed at least one learning module.'),
  ('learner_has_project', null, 'The subject has at least one assigned project.'),
  ('learner_submitted_evidence', null, 'The subject has evidence out of draft.'),
  ('learner_has_credential', null, 'The subject holds at least one issued credential.'),
  ('learner_has_mentorship', null, 'The subject has a mentorship that was answered.'),
  ('learner_has_application', null, 'The subject has submitted at least one application.'),
  ('learner_application_decided', null,
   'At least one of the subject''s applications moved past submitted.'),
  ('learner_outcome_recorded', null, 'The subject accepted an offer.')
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

  /* Every branch reads the table the engine owns, and scopes to the
     instance's own subject. Nothing here computes a domain fact. */
  case p_check
    when 'diagnostic_attempt_started' then
      select exists (select 1 from public.diagnostic_attempts a
        where a.id = p_subject_id and a.profile_id = p_profile) into v_ok;
    when 'diagnostic_attempt_scored' then
      select exists (select 1 from public.diagnostic_attempts a
        where a.id = p_subject_id and a.profile_id = p_profile
          and a.status = 'scored') into v_ok;
    when 'learner_baseline_recorded' then
      select exists (select 1 from public.learner_competencies lc
        where lc.profile_id = p_profile and lc.source = 'baseline') into v_ok;
    when 'learner_has_verified_skill' then
      select exists (select 1 from public.verified_skills vs
        where vs.profile_id = p_profile
          and vs.revoked_at is null and vs.superseded_by is null) into v_ok;
    when 'learner_has_opportunity_match' then
      select exists (select 1 from public.opportunity_matches om
        where om.profile_id = p_profile) into v_ok;
    when 'learner_has_active_pathway' then
      select exists (select 1 from public.pathways p
        where p.profile_id = p_profile and p.status = 'active') into v_ok;

    when 'evidence_submitted_for_review' then
      select exists (select 1 from public.evidence e
        where e.id = p_subject_id and e.profile_id = p_profile
          and e.status in ('submitted','under_review','accepted','rejected')) into v_ok;
    when 'evidence_reviewed' then
      select exists (select 1 from public.review_assignments ra
        join public.evidence e on e.id = ra.evidence_id
        where ra.evidence_id = p_subject_id and e.profile_id = p_profile
          and ra.status in ('approved','rejected','revision_required')) into v_ok;
    when 'evidence_verified' then
      select exists (select 1 from public.verified_skills vs
        where vs.evidence_id = p_subject_id and vs.profile_id = p_profile
          and vs.revoked_at is null and vs.superseded_by is null) into v_ok;

    when 'mentorship_requested' then
      select exists (select 1 from public.mentorships m
        where m.id = p_subject_id and m.learner_profile_id = p_profile
          and m.status = 'requested') into v_ok;
    when 'mentorship_answered' then
      select exists (select 1 from public.mentorships m
        where m.id = p_subject_id and m.learner_profile_id = p_profile
          and m.status in ('accepted','declined','active','completed','ended')) into v_ok;

    when 'application_submitted' then
      select exists (select 1 from public.applications a
        where a.id = p_subject_id and a.profile_id = p_profile
          and a.status <> 'draft') into v_ok;
    when 'application_decided' then
      select exists (select 1 from public.applications a
        where a.id = p_subject_id and a.profile_id = p_profile
          and a.status in ('under_review','shortlisted','offered','rejected',
                           'accepted','withdrawn')) into v_ok;

    -- The coordinator's stages, each profile-scoped.
    when 'learner_profile_exists' then
      select exists (select 1 from public.profiles p where p.id = p_profile) into v_ok;
    when 'learner_onboarded' then
      select exists (select 1 from public.profiles p
        where p.id = p_profile and p.onboarding_state = 'completed') into v_ok;
    when 'learner_completed_a_module' then
      select exists (select 1 from public.learner_module_progress mp
        where mp.profile_id = p_profile and mp.status = 'completed') into v_ok;
    when 'learner_has_project' then
      select exists (select 1 from public.projects pr
        where pr.profile_id = p_profile) into v_ok;
    when 'learner_submitted_evidence' then
      select exists (select 1 from public.evidence e
        where e.profile_id = p_profile and e.status <> 'draft') into v_ok;
    when 'learner_has_credential' then
      select exists (select 1 from public.credentials c
        where c.profile_id = p_profile and c.status = 'issued') into v_ok;
    when 'learner_has_mentorship' then
      select exists (select 1 from public.mentorships m
        where m.learner_profile_id = p_profile
          and m.status in ('accepted','declined','active','completed','ended')) into v_ok;
    when 'learner_has_application' then
      select exists (select 1 from public.applications a
        where a.profile_id = p_profile and a.status <> 'draft') into v_ok;
    when 'learner_application_decided' then
      select exists (select 1 from public.applications a
        where a.profile_id = p_profile
          and a.status in ('under_review','shortlisted','offered','rejected',
                           'accepted','withdrawn')) into v_ok;
    when 'learner_outcome_recorded' then
      select exists (select 1 from public.applications a
        where a.profile_id = p_profile and a.status = 'accepted') into v_ok;
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

-- --------------------------------------------- an optional stage is skipped ---
/* Cancel rather than fail, and say so. An optional stage that times out did
   not go wrong: the run proceeded without it. */
create or replace function btg.skip_work_item(p_item_id uuid, p_reason text)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_item public.workflow_work_items;
begin
  update public.workflow_work_items
  set status = 'cancelled', claimed_by = null, lease_until = null,
      failure = null, result = jsonb_build_object('skipped', true, 'reason', p_reason)
  where id = p_item_id and status in ('pending','ready','claimed','escalated')
  returning * into v_item;
  if not found then
    raise exception 'work item not found or already settled' using errcode = 'P0002';
  end if;

  perform btg.emit_orchestration_event(
    v_item.workflow_instance_id, 'skipped', p_item_id, v_item.step_key,
    jsonb_build_object('reason', p_reason, 'optional', true), v_item.attempts, 'sla');

  perform btg.advance_instance(v_item.workflow_instance_id);
  perform btg.enqueue_ready_steps(v_item.workflow_instance_id);
  return v_item;
end;
$$;

revoke all on function btg.skip_work_item(uuid, text) from public;
revoke all on function btg.skip_work_item(uuid, text) from anon;
revoke all on function btg.skip_work_item(uuid, text) from authenticated;
grant execute on function btg.skip_work_item(uuid, text) to service_role;

-- ------------------------- the dispatcher learns to skip an optional stage ---
create or replace function btg.dispatch_workflow_work(
  p_worker text default 'workflow-dispatcher',
  p_batch integer default 10,
  p_lease_seconds integer default 60,
  /* Null drains the whole queue, as a deployed worker does. Set, it drains one
     run -- which is how the application advances its own learner's work
     without touching anybody else's. */
  p_instance_id uuid default null
)
returns table (
  claimed integer, completed integer, waiting integer,
  retried integer, failed integer, dead integer, skipped integer
)
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_row btg.work_queue;
  v_item public.workflow_work_items;
  v_instance public.workflow_instances;
  v_step public.workflow_definition_steps;
  v_resolvable boolean;
  v_item_id uuid;
  v_done boolean;
  v_result jsonb;
  v_waits integer;
  v_delay interval;
  v_status btg.work_status;
  v_outcome text;
begin
  claimed := 0; completed := 0; waiting := 0;
  retried := 0; failed := 0; dead := 0; skipped := 0;

  for v_row in select * from btg.claim_workflow_items(p_worker, p_lease_seconds, p_batch, p_instance_id)
  loop
    claimed := claimed + 1;
    v_item_id := (v_row.payload->>'work_item_id')::uuid;

    select * into v_item from public.workflow_work_items where id = v_item_id for update;
    if not found then
      perform btg.fail_work_permanently(v_row.id, 'work item no longer exists');
      dead := dead + 1;
      continue;
    end if;

    select * into v_instance from public.workflow_instances
    where id = v_item.workflow_instance_id;

    perform btg.emit_orchestration_event(
      v_instance.id, 'claimed', v_item_id, v_item.step_key,
      jsonb_build_object('worker', p_worker, 'queue_id', v_row.id),
      v_row.attempts, 'dispatcher');

    -- Lifecycle: a settled instance or a settled item is not work.
    if v_instance.status not in ('active','waiting')
       or v_item.status not in ('ready','claimed') then
      perform btg.emit_orchestration_event(
        v_instance.id, 'skipped', v_item_id, v_item.step_key,
        jsonb_build_object('instance_status', v_instance.status,
                           'item_status', v_item.status), v_row.attempts);
      perform btg.complete_work(v_row.id);
      skipped := skipped + 1;
      continue;
    end if;

    select * into v_step from public.workflow_definition_steps
    where definition_version_id = v_instance.definition_version_id
      and step_key = v_item.step_key;

    select is_resolvable into v_resolvable
    from btg.workflow_handlers where handler = v_step.handler;

    if not coalesce(v_resolvable, false) then
      perform btg.emit_orchestration_event(
        v_instance.id, 'failed', v_item_id, v_item.step_key,
        jsonb_build_object('reason', 'handler not resolvable',
                           'handler', v_step.handler), v_row.attempts);
      perform btg.abandon_work_item(v_item_id, format('handler %s is not resolvable', v_step.handler));
      perform btg.fail_work_permanently(v_row.id, 'handler not resolvable');
      failed := failed + 1;
      continue;
    end if;

    perform btg.emit_orchestration_event(
      v_instance.id, 'handler_resolved', v_item_id, v_item.step_key,
      jsonb_build_object('handler', v_step.handler,
                         'command', v_step.domain_command,
                         'check', v_step.completion_check), v_row.attempts);

    v_done := false;
    v_result := '{}'::jsonb;
    v_outcome := null;

    /* Execution and completion share one subtransaction. A handler that
       raises -- or a completion the domain then refuses -- rolls back every
       effect of the attempt, so a retry never sees half of a previous one.
       This is also why the queue insertion for the next step sits inside the
       block: intent and enqueue commit together or not at all. */
    begin
      case v_step.handler
        when 'noop' then
          v_done := true;

        when 'timer' then
          v_done := v_item.available_at <= now();

        when 'await_domain_state' then
          v_done := btg.assert_step_satisfied(
            v_step.completion_check, v_item.subject_type, v_item.subject_id,
            v_instance.subject_profile_id);

        when 'domain_command' then
          v_result := btg.invoke_domain_command(
            v_step.domain_command, v_instance.subject_profile_id, v_item.subject_id);
          perform btg.emit_orchestration_event(
            v_instance.id, 'domain_command_invoked', v_item_id, v_item.step_key,
            jsonb_build_object('command', v_step.domain_command, 'result', v_result),
            v_row.attempts);
          v_done := true;

        when 'human_review' then
          v_done := false;
        when 'approval' then
          v_done := false;
        else
          raise exception 'handler % has no dispatcher branch', v_step.handler
            using errcode = '42501';
      end case;

      if v_step.handler in ('human_review','approval') then
        -- A person's work waits for the person. Nothing polls a human.
        perform btg.emit_orchestration_event(
          v_instance.id, 'awaiting_human', v_item_id, v_item.step_key,
          jsonb_build_object('owner_kind', v_item.owner_kind,
                             'owner_persona', v_item.owner_persona,
                             'deadline_at', v_item.deadline_at), v_row.attempts);
        perform btg.complete_work(v_row.id);
        v_outcome := 'waiting';

      elsif v_done then
        perform btg.complete_work_item(v_item_id, v_result);
        perform btg.emit_orchestration_event(
          v_instance.id, 'completed', v_item_id, v_item.step_key,
          jsonb_build_object('result', v_result), v_row.attempts);
        perform btg.complete_work(v_row.id);
        perform btg.enqueue_ready_steps(v_instance.id);
        v_outcome := 'completed';

      elsif v_item.deadline_at is not null and v_item.deadline_at < now() then
        if coalesce(v_step.is_optional, false) then
          /* An optional stage that timed out did not go wrong: the run
             proceeded without it, and the stream records that it did. */
          perform btg.skip_work_item(
            v_item_id, format('optional stage timed out waiting for %s', v_step.completion_check));
          perform btg.complete_work(v_row.id);
          v_outcome := 'skipped';
        else
          perform btg.emit_orchestration_event(
            v_instance.id, 'failed', v_item_id, v_item.step_key,
            jsonb_build_object('reason', 'deadline passed',
                               'check', v_step.completion_check), v_row.attempts);
          perform btg.abandon_work_item(
            v_item_id, format('deadline passed waiting for %s', v_step.completion_check));
          perform btg.fail_work_permanently(v_row.id, 'deadline passed');
          v_outcome := 'failed';
        end if;

      else
        -- Still waiting on the domain. Re-check on a widening interval; the
        -- signal is what normally ends the wait before any of these fire.
        select count(*) into v_waits from btg.orchestration_events
        where work_item_id = v_item_id and event_type = 'awaiting_domain_state';
        v_delay := least(
          interval '1 hour',
          (power(2, least(v_waits, 7)) * interval '30 seconds'));

        perform btg.emit_orchestration_event(
          v_instance.id, 'awaiting_domain_state', v_item_id, v_item.step_key,
          jsonb_build_object('check', v_step.completion_check,
                             'recheck_in_seconds', extract(epoch from v_delay)::int),
          v_row.attempts);
        perform btg.complete_work(v_row.id);
        perform btg.enqueue_workflow_step(v_item_id, v_delay, 'await recheck');
        v_outcome := 'waiting';
      end if;

    exception when others then
      v_status := btg.fail_work(v_row.id, sqlerrm);
      if v_status = 'dead' then
        perform btg.emit_orchestration_event(
          v_instance.id, 'dead_lettered', v_item_id, v_item.step_key,
          jsonb_build_object('error', sqlerrm), v_row.attempts);
        perform btg.abandon_work_item(v_item_id, sqlerrm);
        v_outcome := 'dead';
      else
        perform btg.emit_orchestration_event(
          v_instance.id, 'retry_scheduled', v_item_id, v_item.step_key,
          jsonb_build_object('error', sqlerrm), v_row.attempts);
        v_outcome := 'retried';
      end if;
    end;

    case v_outcome
      when 'completed' then completed := completed + 1;
      when 'waiting' then waiting := waiting + 1;
      when 'retried' then retried := retried + 1;
      when 'failed' then failed := failed + 1;
      when 'dead' then dead := dead + 1;
      when 'skipped' then skipped := skipped + 1;
      else null;
    end case;
  end loop;

  return next;
end;
$$;

revoke all on function btg.dispatch_workflow_work(text, integer, integer, uuid) from public;
revoke all on function btg.dispatch_workflow_work(text, integer, integer, uuid) from anon;
revoke all on function btg.dispatch_workflow_work(text, integer, integer, uuid) from authenticated;
grant execute on function btg.dispatch_workflow_work(text, integer, integer, uuid) to service_role;

-- ------------------------------------------------------- the coordinator ---
do $$
declare v_def uuid; v_version uuid;
begin
  select id into v_def from public.workflow_definitions where key = 'BTG_LEARNER_TO_OPPORTUNITY';

  if not exists (select 1 from public.workflow_definition_versions
                 where definition_id = v_def and status = 'published') then
    insert into public.workflow_definition_versions (definition_id, notes)
    values (v_def, 'W14-G: sign-up to an accepted offer. Twelve waits on engine state, two allowlisted system commands, three optional stages.')
    returning id into v_version;

    insert into public.workflow_definition_steps (
      definition_version_id, step_key, ordinal, item_type, handler,
      completion_check, domain_command, owner_kind, sla_hours, is_optional, audit_workflow
    ) values
      (v_version, 'signed_up', 1, 'system', 'await_domain_state',
       'learner_profile_exists', null, 'system', null, false, 'signup'),
      (v_version, 'onboarded', 2, 'system', 'await_domain_state',
       'learner_onboarded', null, 'system', null, false, 'onboarding'),
      (v_version, 'baseline_measured', 3, 'system', 'await_domain_state',
       'learner_baseline_recorded', null, 'system', null, false, 'baseline_diagnostic'),
      (v_version, 'pathway_generated', 4, 'system', 'domain_command',
       'learner_has_active_pathway', 'generate_pathway_for', 'system', 24, false, 'pathway_generation'),
      /* Optional: a learner may enter through evidence rather than a module. */
      (v_version, 'learning_started', 5, 'wait', 'await_domain_state',
       'learner_completed_a_module', null, 'system', 720, true, 'learning'),
      (v_version, 'project_assigned', 6, 'wait', 'await_domain_state',
       'learner_has_project', null, 'system', null, false, 'projects'),
      (v_version, 'evidence_submitted', 7, 'wait', 'await_domain_state',
       'learner_submitted_evidence', null, 'system', null, false, 'evidence'),
      /* No reviewer step: the `verification` workflow owns that queue. This
         waits for the outcome the verification engine produced. */
      (v_version, 'skill_verified', 8, 'wait', 'await_domain_state',
       'learner_has_verified_skill', null, 'system', null, false, 'verification'),
      /* Optional: a verified skill does not always complete a whole credential. */
      (v_version, 'credential_issued', 9, 'wait', 'await_domain_state',
       'learner_has_credential', null, 'system', 720, true, 'credentials'),
      /* Optional: a learner may never take a mentor. */
      (v_version, 'mentorship_matched', 10, 'wait', 'await_domain_state',
       'learner_has_mentorship', null, 'system', 720, true, 'mentorship'),
      (v_version, 'matches_computed', 11, 'system', 'domain_command',
       'learner_has_opportunity_match', 'compute_opportunity_matches', 'system', 24, false, 'matching'),
      (v_version, 'applied', 12, 'wait', 'await_domain_state',
       'learner_has_application', null, 'system', null, false, 'opportunities'),
      (v_version, 'decision_received', 13, 'wait', 'await_domain_state',
       'learner_application_decided', null, 'system', null, false, 'opportunities'),
      /* Not optional and with no deadline: an accepted offer is the point of
         the platform, and a run that has not got there is honestly still
         waiting rather than quietly finished. */
      (v_version, 'outcome_recorded', 14, 'wait', 'await_domain_state',
       'learner_outcome_recorded', null, 'system', null, false, 'opportunities');

    perform btg.publish_definition_version(v_version);
  end if;

  update public.workflow_definitions
  set is_enabled = true, is_self_startable = true
  where key = 'BTG_LEARNER_TO_OPPORTUNITY';
end $$;
