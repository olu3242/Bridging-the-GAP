-- W14-D application convergence — the bridge between the app and the runtime.
--
-- Three problems are solved here, and one is a genuine architectural decision.
--
-- 1. The dispatcher has to be able to drive the pathway engine. It could not:
--    public.generate_pathway resolves auth.uid(), and the runtime is a worker
--    with no session. The engine command is therefore *extracted*, not
--    duplicated: the logic moves once into btg.generate_pathway_for(profile),
--    and public.generate_pathway becomes a thin session wrapper over it. There
--    is still exactly one implementation of pathway generation.
--
-- 2. A runtime action about a learner has no actor, so the learner could not
--    see it in their own timeline: audit RLS keys on actor_profile_id. The
--    ledger now recognises a named *subject*, written only by definer
--    functions, so "whose outcome is this" stops being conflated with "who
--    acted". Attribution is unchanged: the runtime is still the actor of its
--    own actions.
--
-- 3. The application cannot hold a service-role key, so it cannot start,
--    signal or advance a run -- which would leave the Workflow OS a backend
--    with no product attached. Three narrow session-callable commands close
--    that, each restricted to the caller's own runs:
--
--      public.ensure_my_workflow(key)     declare intent; one instance per
--                                          learner per self-startable workflow
--      public.signal_my_workflows(...)    tell the runtime a domain entity moved
--      public.advance_my_workflows()      drain the caller's own queued work
--
--    None of them is a domain mutation and none chooses what runs: the pinned
--    definition decides the steps, the handler allowlist decides what may
--    execute, and every completion is still re-verified against the engines. A
--    deployed invoker remains the right way to run this at scale; it is now a
--    robustness layer rather than a hard dependency, so the product works
--    without the key this environment cannot hold.

-- ------------------------------------------ 1. the extracted engine command ---
create or replace function btg.generate_pathway_for(
  p_profile_id uuid,
  p_correlation_id uuid default null
)
returns public.pathways
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := p_profile_id;
  v_prev public.pathways;
  v_pathway public.pathways;
  v_attempt uuid;
  v_version smallint;
  v_count int;
  v_step record;
  v_position smallint := 0;
begin
  if v_actor is null then
    raise exception 'a pathway needs a learner' using errcode = 'check_violation';
  end if;

  -- A pathway is only meaningful once a baseline exists.
  if not exists (select 1 from public.learner_competencies where profile_id = v_actor) then
    raise exception 'complete the baseline diagnostic before generating a pathway'
      using errcode = 'check_violation';
  end if;

  select * into v_prev from public.pathways
  where profile_id = v_actor and status = 'active' for update;

  select coalesce(max(version), 0) + 1 into v_version
  from public.pathways where profile_id = v_actor;

  select id into v_attempt from public.diagnostic_attempts
  where profile_id = v_actor and status = 'scored'
  order by scored_at desc limit 1;

  insert into public.pathways (profile_id, version, status, generated_from_attempt_id)
  values (v_actor, v_version, 'draft', v_attempt)
  returning * into v_pathway;

  -- Step the previous plan down first: pathways_one_active permits a single
  -- active row per learner, and it is checked on the activating update below.
  if v_prev.id is not null then
    update public.pathways
    set status = 'superseded', superseded_at = now(), superseded_by = v_pathway.id
    where id = v_prev.id;
  end if;

  -- Ordering: topological depth in the prerequisite graph, then widest gap.
  -- Depth is computed from the competency graph, which a trigger keeps acyclic,
  -- so this recursion terminates.
  for v_step in
    with recursive depth(competency_id, depth) as (
      select c.id, 0
      from public.competencies c
      where not exists (select 1 from public.competency_prerequisites p where p.competency_id = c.id)
      union all
      select p.competency_id, d.depth + 1
      from public.competency_prerequisites p
      join depth d on d.competency_id = p.prerequisite_id
    ),
    resolved as (
      select competency_id, max(depth) as depth from depth group by competency_id
    )
    select g.competency_id, g.level, g.target_level, g.gap, g.name,
           coalesce(r.depth, 0) as depth, g.unmet_prerequisites
    from public.learner_competency_gaps g
    left join resolved r on r.competency_id = g.competency_id
    join public.competencies c on c.id = g.competency_id
    where g.profile_id = v_actor and g.gap > 0
    order by coalesce(r.depth, 0), g.gap desc, c.sort_order
  loop
    v_position := v_position + 1;
    insert into public.pathway_steps (
      pathway_id, competency_id, position, from_level, target_level, depth, rationale, status
    ) values (
      v_pathway.id, v_step.competency_id, v_position, v_step.level, v_step.target_level,
      v_step.depth,
      format(
        'Your baseline put %s at level %s and opportunity-ready is %s.%s',
        v_step.name, v_step.level, v_step.target_level,
        case when array_length(v_step.unmet_prerequisites, 1) > 0
          then ' Comes after ' || array_to_string(v_step.unmet_prerequisites, ' and ') || '.'
          else '' end
      ),
      'locked'
    );
  end loop;

  select count(*) into v_count from public.pathway_steps where pathway_id = v_pathway.id;
  if v_count = 0 then
    -- Nothing to close. Record the empty plan rather than inventing steps.
    update public.pathways set
      status = 'active', activated_at = now(),
      rationale = jsonb_build_object(
        'source', 'competency_baseline', 'ordering', 'prerequisite_depth,gap_desc',
        'steps', 0, 'note', 'every measured competency is already at target')
    where id = v_pathway.id returning * into v_pathway;
    update public.profiles set active_pathway_id = v_pathway.id where id = v_actor;

    /* Defect closed: this branch used to return with no ledger entry at all,
       so a learner with no gaps had an active pathway that their own timeline
       never showed -- and a W14 step waiting on the evidence would have waited
       forever. An empty plan is a real outcome and is recorded as one. */
    if auth.uid() is not null then
      perform public.record_audit_event(
        'pathway.pathway.generated', 'pathway', v_pathway.id::text, null, null,
        case when v_prev.id is null then null else jsonb_build_object('previous_version', v_prev.version) end,
        v_pathway.rationale, 'notice'::public.btg_audit_severity, p_correlation_id, 'pathway_generation'
      );
    else
      perform btg.record_workflow_event(
        'pathway.pathway.generated', 'pathway', v_pathway.id::text, null,
        case when v_prev.id is null then null else jsonb_build_object('previous_version', v_prev.version) end,
        v_pathway.rationale, 'notice'::public.btg_audit_severity, 'pathway_generation',
        jsonb_build_object('subject', v_actor)
      );
    end if;

    return v_pathway;
  end if;

  -- Project prerequisite edges onto the steps that exist in this pathway.
  insert into public.pathway_step_dependencies (step_id, depends_on_step_id)
  select s.id, prereq.id
  from public.pathway_steps s
  join public.competency_prerequisites cp on cp.competency_id = s.competency_id
  join public.pathway_steps prereq
    on prereq.pathway_id = s.pathway_id and prereq.competency_id = cp.prerequisite_id
  where s.pathway_id = v_pathway.id
  on conflict do nothing;

  -- A step with no unmet dependency inside this pathway starts available.
  update public.pathway_steps s set status = 'available', unlocked_at = now()
  where s.pathway_id = v_pathway.id
    and not exists (
      select 1 from public.pathway_step_dependencies d where d.step_id = s.id
    );

  update public.pathways set
    status = 'active', activated_at = now(),
    rationale = jsonb_build_object(
      'source', 'competency_baseline',
      'ordering', 'prerequisite_depth,gap_desc,catalogue_order',
      'steps', v_count,
      'from_attempt', v_attempt,
      'supersedes', v_prev.id
    )
  where id = v_pathway.id
  returning * into v_pathway;

  update public.profiles set active_pathway_id = v_pathway.id where id = v_actor;

  if auth.uid() is not null then
    perform public.record_audit_event(
      'pathway.pathway.generated', 'pathway', v_pathway.id::text, null, null,
      case when v_prev.id is null then null else jsonb_build_object('previous_version', v_prev.version) end,
      v_pathway.rationale, 'notice'::public.btg_audit_severity, p_correlation_id, 'pathway_generation'
    );
  else
    /* Driven by the runtime, which has no session. The runtime is recorded as
       the actor -- the learner did not do this -- and the learner is named as
       the subject so their own timeline still shows it. */
    perform btg.record_workflow_event(
      'pathway.pathway.generated', 'pathway', v_pathway.id::text, null,
      case when v_prev.id is null then null else jsonb_build_object('previous_version', v_prev.version) end,
      v_pathway.rationale, 'notice'::public.btg_audit_severity, 'pathway_generation',
      jsonb_build_object('subject', v_actor)
    );
  end if;

  /* btg.notify rather than public.enqueue_notification: the public writer
     requires auth.uid() and would make this command undrivable by a worker.
     Same table, same dedupe key, same row -- the internal writer is what the
     other engines already use for exactly this reason. */
  perform btg.notify(
    v_actor, 'pathway.generated', 'Your pathway is ready',
    'pathway.generated:' || v_pathway.id::text,
    format('%s steps, ordered so nothing arrives before its prerequisites.', v_count),
    '/pathway'
  );

  return v_pathway;
end;
$$;

create or replace function public.generate_pathway(p_correlation_id uuid default null)
returns public.pathways
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  return btg.generate_pathway_for(v_actor, p_correlation_id);
end;
$$;

revoke all on function btg.generate_pathway_for(uuid, uuid) from public;
revoke all on function btg.generate_pathway_for(uuid, uuid) from anon;
revoke all on function btg.generate_pathway_for(uuid, uuid) from authenticated;
grant execute on function btg.generate_pathway_for(uuid, uuid) to service_role;

revoke all on function public.generate_pathway(uuid) from public;
grant execute on function public.generate_pathway(uuid) to authenticated, service_role;

-- ----------------------------------------- 2. the ledger's named subject ---
/* A learner sees a row they acted on, a row about them, a row for an
   organization they govern, or everything if they are an operator. `metadata`
   is written only from inside a definer function -- 003800 closed the ledger
   to sessions entirely -- so `metadata.subject` cannot be forged from a
   session to read somebody else's history. */
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated
using (
  actor_profile_id = auth.uid()
  or (metadata ? 'subject' and (metadata->>'subject')::uuid = auth.uid())
  or btg.is_operator()
  or (organization_id is not null and organization_id in (select btg.governed_org_ids()))
);

/* The outcome timeline keys on whose outcome it is, which is the actor for a
   learner's own action and the named subject for a runtime action taken on
   their behalf. */
create or replace view public.outcome_timeline_view
with (security_invoker = true) as
select
  a.id,
  coalesce(a.actor_profile_id, (a.metadata->>'subject')::uuid) as profile_id,
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

-- --------------------------------------- 3. allowlist + pathway workflow ---
insert into btg.workflow_commands (name, requires_subject, requires_session_actor, description)
values
  ('generate_pathway_for', true, false,
   'Generates the subject''s pathway through the pathway engine. The same implementation public.generate_pathway calls; supersedes the previous plan and never leaves two active.')
on conflict (name) do update set
  requires_subject = excluded.requires_subject,
  requires_session_actor = excluded.requires_session_actor,
  description = excluded.description;

insert into btg.workflow_checks (name, requires_subject_type, description) values
  ('learner_has_active_pathway', null,
   'The subject has an active pathway. An empty plan counts: a learner already at target has nothing to close.')
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
      /* No step join: a learner already at target gets a legitimately empty
         plan, and requiring a step would leave that workflow waiting on
         something the engine will never produce. */
      select exists (
        select 1 from public.pathways p
        where p.profile_id = p_profile and p.status = 'active') into v_ok;
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

-- ------------------------------------------- 4. self-startable workflows ---
alter table public.workflow_definitions
  add column if not exists is_self_startable boolean not null default false;
comment on column public.workflow_definitions.is_self_startable is
  'True when a learner''s own application may declare intent to run this for themselves.';

update public.workflow_definitions set is_self_startable = true
where key in ('baseline_diagnostic', 'pathway_generation', 'matching');

do $$
declare v_def uuid; v_version uuid;
begin
  select id into v_def from public.workflow_definitions where key = 'pathway_generation';

  if not exists (select 1 from public.workflow_definition_versions
                 where definition_id = v_def and status = 'published') then
    insert into public.workflow_definition_versions (definition_id, notes)
    values (v_def, 'W14-D: awaits the measured baseline, then generates the pathway through the engine.')
    returning id into v_version;

    insert into public.workflow_definition_steps (
      definition_version_id, step_key, ordinal, item_type, handler,
      completion_check, domain_command, owner_kind, sla_hours, audit_workflow
    ) values
      (v_version, 'baseline_measured', 1, 'system', 'await_domain_state',
       'learner_baseline_recorded', null, 'system', null, 'baseline_diagnostic'),
      (v_version, 'pathway_generated', 2, 'system', 'domain_command',
       'learner_has_active_pathway', 'generate_pathway_for', 'system', 24, 'pathway_generation');

    perform btg.publish_definition_version(v_version);
  end if;

  update public.workflow_definitions set is_enabled = true where key = 'pathway_generation';
end $$;

-- ------------------------------------------------ 5. the scoped claim ---
/* Same queue, same semantics, scoped to one run. Not a second queue: one more
   claim statement over btg.work_queue so the application can drain its own
   work without draining everyone's. */
create or replace function btg.claim_workflow_items(
  p_worker text,
  p_lease_seconds integer default 60,
  p_batch integer default 10,
  p_instance_id uuid default null
)
returns setof btg.work_queue
language plpgsql security definer set search_path = public, btg, pg_temp as $$
begin
  if p_instance_id is null then
    return query select * from btg.claim_work('workflow', p_worker, p_lease_seconds, p_batch);
  else
    return query
    update btg.work_queue q
    set status = 'claimed', attempts = q.attempts + 1, claimed_at = now(),
        claimed_by = p_worker,
        lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    where q.id in (
      select c.id from btg.work_queue c
      where c.queue = 'workflow' and c.status = 'queued'
        and c.available_at <= now()
        and (c.payload->>'instance_id') = p_instance_id::text
      order by c.available_at, c.id
      for update skip locked
      limit greatest(coalesce(p_batch, 10), 1)
    )
    returning q.*;
  end if;
end;
$$;

revoke all on function btg.claim_workflow_items(text, integer, integer, uuid) from public;
revoke all on function btg.claim_workflow_items(text, integer, integer, uuid) from anon;
revoke all on function btg.claim_workflow_items(text, integer, integer, uuid) from authenticated;
grant execute on function btg.claim_workflow_items(text, integer, integer, uuid) to service_role;

-- ------------------------------------- 6. the dispatcher, optionally scoped ---
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
        perform btg.emit_orchestration_event(
          v_instance.id, 'failed', v_item_id, v_item.step_key,
          jsonb_build_object('reason', 'deadline passed',
                             'check', v_step.completion_check), v_row.attempts);
        perform btg.abandon_work_item(
          v_item_id, format('deadline passed waiting for %s', v_step.completion_check));
        perform btg.fail_work_permanently(v_row.id, 'deadline passed');
        v_outcome := 'failed';

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
      else null;
    end case;
  end loop;

  return next;
end;
$$;

drop function if exists btg.dispatch_workflow_work(text, integer, integer);
revoke all on function btg.dispatch_workflow_work(text, integer, integer, uuid) from public;
revoke all on function btg.dispatch_workflow_work(text, integer, integer, uuid) from anon;
revoke all on function btg.dispatch_workflow_work(text, integer, integer, uuid) from authenticated;
grant execute on function btg.dispatch_workflow_work(text, integer, integer, uuid) to service_role;

-- ------------------------------------- 7. the application's narrow surface ---
/* Declare intent. Not a domain mutation: it creates execution state for the
   caller, on a definition the platform marked self-startable, once. The
   idempotency key is the learner and the workflow, so a refresh, a retry or a
   double submit all land on the same instance. */
create or replace function public.ensure_my_workflow(p_definition_key text)
returns public.workflow_instances
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_def public.workflow_definitions;
  v_instance public.workflow_instances;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  select * into v_def from public.workflow_definitions where key = p_definition_key;
  if not found or not v_def.is_self_startable then
    raise exception 'workflow % cannot be started from an application session', p_definition_key
      using errcode = '42501';
  end if;
  if v_def.scope = 'organization' then
    raise exception 'workflow % is organization-scoped', p_definition_key
      using errcode = '42501';
  end if;

  v_instance := btg.start_workflow(
    p_definition_key, v_actor, null, p_definition_key || ':' || v_actor::text);
  return v_instance;
end;
$$;

/* Tell the runtime that a domain entity of the caller's moved. Scoped to the
   caller by construction -- the profile argument is auth.uid(), never a
   parameter -- so no session can wake, bind or advance another learner's run. */
create or replace function public.signal_my_workflows(
  p_subject_type text default null,
  p_subject_id uuid default null
)
returns integer language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return btg.signal_workflow_subject(v_actor, p_subject_type, p_subject_id);
end;
$$;

/* Drain the caller's own queued work. The caller chooses nothing about what
   runs: the pinned definition names the steps, btg.workflow_handlers decides
   which classes may execute, btg.workflow_commands bounds what a step may
   invoke, and every completion is re-verified against the engines. A deployed
   invoker does the same thing on a schedule and for everyone. */
create or replace function public.advance_my_workflows(p_batch integer default 5)
returns table (
  instances integer, completed integer, waiting integer,
  retried integer, failed integer
)
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_instance record;
  v_pass record;
  v_pass_no integer;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;
  instances := 0; completed := 0; waiting := 0; retried := 0; failed := 0;

  for v_instance in
    select id from public.workflow_instances
    where subject_profile_id = v_actor and status in ('created','active','waiting')
    order by created_at
    limit greatest(least(coalesce(p_batch, 5), 20), 1)
  loop
    instances := instances + 1;
    /* Several passes, because completing a step enqueues the next one after
       this pass already chose its rows. Bounded at four so one request can
       never become an unbounded drain: the deployed invoker picks up whatever
       is left. */
    for v_pass_no in 1..4 loop
      select * into v_pass from btg.dispatch_workflow_work(
        'app:' || v_actor::text, 10, 60, v_instance.id);
      completed := completed + coalesce(v_pass.completed, 0);
      waiting := waiting + coalesce(v_pass.waiting, 0);
      retried := retried + coalesce(v_pass.retried, 0);
      failed := failed + coalesce(v_pass.failed, 0) + coalesce(v_pass.dead, 0);
      exit when coalesce(v_pass.claimed, 0) = 0;
    end loop;
  end loop;

  return next;
end;
$$;

do $$ declare fn text;
begin
  foreach fn in array array[
    'public.ensure_my_workflow(text)',
    'public.signal_my_workflows(text, uuid)',
    'public.advance_my_workflows(integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

/* A learner's current runtime state, for the journey resolver. security_invoker
   so the instance and work-item policies decide what is visible; no new read
   surface, just a shape the application can consume. */
create or replace view public.my_workflow_state
with (security_invoker = true) as
select
  i.id as instance_id,
  d.key as workflow,
  d.name as workflow_name,
  v.version,
  i.status as instance_status,
  i.subject_profile_id as profile_id,
  i.started_at,
  i.settled_at,
  i.failure,
  w.id as work_item_id,
  w.step_key,
  s.ordinal as step_ordinal,
  w.item_type,
  s.handler,
  w.status as work_item_status,
  w.owner_kind,
  w.owner_persona,
  w.attempts,
  w.deadline_at,
  w.failure as work_item_failure,
  (select count(*) from public.workflow_definition_steps ds
    where ds.definition_version_id = i.definition_version_id) as step_count
from public.workflow_instances i
join public.workflow_definition_versions v on v.id = i.definition_version_id
join public.workflow_definitions d on d.id = v.definition_id
left join public.workflow_work_items w on w.workflow_instance_id = i.id
left join public.workflow_definition_steps s
  on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key;

grant select on public.my_workflow_state to authenticated, service_role;

-- ------------------------- 8. the catalog a learner is entitled to see ---
/* my_workflow_state joins the definition catalog, which was operator-only --
   so a learner would have read zero rows from a view about their own run. The
   catalog opens by exactly one step: a learner may read a definition, version
   and step catalog that one of their OWN instances pins, and nothing else.
   Answered by definer helpers so a policy never reads a table whose policy
   reads it back (defect 14's class). */
create or replace function btg.runs_definition(p_definition uuid)
returns boolean language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select exists (
    select 1
    from public.workflow_instances i
    join public.workflow_definition_versions v on v.id = i.definition_version_id
    where v.definition_id = p_definition
      and (i.subject_profile_id = auth.uid()
           or (i.organization_id is not null
               and i.organization_id in (select btg.governed_org_ids())))
  );
$$;

create or replace function btg.runs_version(p_version uuid)
returns boolean language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select exists (
    select 1 from public.workflow_instances i
    where i.definition_version_id = p_version
      and (i.subject_profile_id = auth.uid()
           or (i.organization_id is not null
               and i.organization_id in (select btg.governed_org_ids())))
  );
$$;

revoke all on function btg.runs_definition(uuid) from public;
revoke all on function btg.runs_definition(uuid) from anon;
grant execute on function btg.runs_definition(uuid) to authenticated, service_role;
revoke all on function btg.runs_version(uuid) from public;
revoke all on function btg.runs_version(uuid) from anon;
grant execute on function btg.runs_version(uuid) to authenticated, service_role;

drop policy if exists workflow_definitions_select on public.workflow_definitions;
create policy workflow_definitions_select on public.workflow_definitions
  for select to authenticated using (btg.is_operator() or btg.runs_definition(id));

drop policy if exists workflow_versions_select on public.workflow_definition_versions;
create policy workflow_versions_select on public.workflow_definition_versions
  for select to authenticated using (btg.is_operator() or btg.runs_version(id));

drop policy if exists workflow_steps_select on public.workflow_definition_steps;
create policy workflow_steps_select on public.workflow_definition_steps
  for select to authenticated
  using (btg.is_operator() or btg.runs_version(definition_version_id));

-- ------------------------- 9. the bridge learns the pathway command ---
create or replace function btg.invoke_domain_command(
  p_command text,
  p_profile uuid,
  p_subject_id uuid default null
)
returns jsonb language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_cmd btg.workflow_commands; v_out jsonb; v_pathway public.pathways;
begin
  select * into v_cmd from btg.workflow_commands where name = p_command;
  if not found then
    raise exception 'command % is not allowlisted', p_command using errcode = '42501';
  end if;
  if v_cmd.requires_session_actor then
    raise exception
      'command % needs a session actor; the runtime is a worker, not an actor',
      p_command using errcode = '42501';
  end if;
  if v_cmd.requires_subject and p_profile is null then
    raise exception 'command % needs a subject profile', p_command
      using errcode = 'check_violation';
  end if;

  case p_command
    when 'compute_opportunity_matches' then
      v_out := jsonb_build_object('matches', btg.compute_opportunity_matches(p_profile));
    when 'drain_notifications' then
      select to_jsonb(d) into v_out
      from btg.drain_notifications('workflow-dispatcher', 25, 60) d;
    when 'generate_pathway_for' then
      v_pathway := btg.generate_pathway_for(p_profile);
      v_out := jsonb_build_object('pathway', v_pathway.id, 'version', v_pathway.version,
                                  'status', v_pathway.status);
    else
      raise exception 'command % is allowlisted but not implemented', p_command
        using errcode = '42501';
  end case;

  return coalesce(v_out, '{}'::jsonb);
end;
$$;

revoke all on function btg.invoke_domain_command(text, uuid, uuid) from public;
revoke all on function btg.invoke_domain_command(text, uuid, uuid) from anon;
revoke all on function btg.invoke_domain_command(text, uuid, uuid) from authenticated;
grant execute on function btg.invoke_domain_command(text, uuid, uuid) to service_role;

/* Every allowlisted command has a branch. A row with no implementation would
   mean a step that dead-letters at run time instead of being refused now. */
do $$ declare v_missing text;
begin
  select string_agg(c.name, ', ') into v_missing
  from btg.workflow_commands c
  join pg_proc p on p.proname = 'invoke_domain_command'
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'btg'
  where not c.requires_session_actor
    and p.prosrc not like '%''' || c.name || '''%';
  if v_missing is not null then
    raise exception 'allowlisted commands with no dispatcher branch: %', v_missing;
  end if;
end $$;
