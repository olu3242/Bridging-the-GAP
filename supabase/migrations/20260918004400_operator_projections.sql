-- W14-F — the operator control plane.
--
-- Four projections and nothing else: no view here writes, and none is a way
-- round a policy. Three are `security_invoker`, so the instance and work-item
-- policies decide what a caller sees and an operator simply satisfies them.
--
-- workflow_timeline_view is the exception and deliberately so: it reads
-- btg.orchestration_events, which no session role may read at all. Invoker
-- semantics there would return nothing to everybody, so the view carries
-- definer semantics with the authorization inlined -- the same shape and the
-- same reason as public.cohort_outcomes. The boundary is asserted by test:
-- anyone who is not an operator gets zero rows, and the underlying table stays
-- unreadable and unwritable from any session.

-- ------------------------------------------- "waiting for what", precisely ---
/* The instance view said "waiting to be told which record it concerns" for
   every unbound await step -- including the ones whose check needs no record
   at all, which is simply wrong and would send an operator looking for a
   binding that was never required. The requirement lives in
   btg.workflow_checks, which no session role may read, so a definer predicate
   answers the one question the projection needs. It discloses nothing beyond
   whether a named check takes a subject, and the name is already on the step. */
create or replace function btg.check_requires_subject(p_check text)
returns boolean language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select coalesce(
    (select c.requires_subject_type is not null
     from btg.workflow_checks c where c.name = p_check),
    false);
$$;

revoke all on function btg.check_requires_subject(text) from public;
revoke all on function btg.check_requires_subject(text) from anon;
grant execute on function btg.check_requires_subject(text) to authenticated, service_role;

/* last_event_at reads btg.orchestration_events, which no session role may
   read -- and a security_invoker view that touches it fails outright for every
   caller rather than returning less. A definer predicate answers the one
   question the projection needs: when the runtime last did anything on this
   run. */
create or replace function btg.last_event_at(p_instance uuid)
returns timestamptz language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select max(e.occurred_at) from btg.orchestration_events e
  where e.workflow_instance_id = p_instance;
$$;

revoke all on function btg.last_event_at(uuid) from public;
revoke all on function btg.last_event_at(uuid) from anon;
grant execute on function btg.last_event_at(uuid) to authenticated, service_role;

-- ------------------------------------------------------ 1. where is the run ---
create or replace view public.workflow_instance_view
with (security_invoker = true) as
with steps as (
  select
    w.workflow_instance_id,
    count(*) as steps_total,
    count(*) filter (where w.status = 'completed') as steps_completed,
    count(*) filter (where w.status in ('failed')) as steps_failed,
    count(*) filter (where w.status = 'escalated') as steps_escalated,
    max(w.attempts) as max_attempts_used
  from public.workflow_work_items w
  group by w.workflow_instance_id
),
current_step as (
  select distinct on (w.workflow_instance_id)
    w.workflow_instance_id,
    w.id as work_item_id,
    w.step_key,
    s.ordinal,
    w.item_type,
    s.handler,
    s.completion_check,
    s.domain_command,
    w.status,
    w.owner_kind,
    w.owner_persona,
    w.owner_profile_id,
    w.attempts,
    w.max_attempts,
    w.deadline_at,
    w.subject_type,
    w.subject_id,
    w.failure
  from public.workflow_work_items w
  join public.workflow_instances i on i.id = w.workflow_instance_id
  join public.workflow_definition_steps s
    on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
  where w.status in ('ready','claimed','escalated','failed','pending')
  order by w.workflow_instance_id,
           case w.status
             when 'failed' then 0 when 'escalated' then 1 when 'claimed' then 2
             when 'ready' then 3 else 4 end,
           s.ordinal
),
next_step as (
  select distinct on (w.workflow_instance_id)
    w.workflow_instance_id, w.step_key, s.ordinal
  from public.workflow_work_items w
  join public.workflow_instances i on i.id = w.workflow_instance_id
  join public.workflow_definition_steps s
    on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
  where w.status = 'pending'
  order by w.workflow_instance_id, s.ordinal
)
select
  i.id as instance_id,
  d.key as workflow,
  d.name as workflow_name,
  v.version as definition_version,
  i.status as instance_status,
  i.subject_profile_id,
  i.organization_id,
  i.started_at,
  i.settled_at,
  i.failure as instance_failure,
  coalesce(st.steps_total, 0) as steps_total,
  coalesce(st.steps_completed, 0) as steps_completed,
  coalesce(st.steps_failed, 0) as steps_failed,
  coalesce(st.steps_escalated, 0) as steps_escalated,
  coalesce(st.max_attempts_used, 0) as attempts_used,
  cs.work_item_id as current_work_item_id,
  cs.step_key as current_step,
  cs.ordinal as current_step_ordinal,
  cs.item_type as current_item_type,
  cs.handler as current_handler,
  cs.status as current_step_status,
  cs.attempts as current_attempts,
  cs.max_attempts as current_max_attempts,
  cs.failure as current_failure,
  /* Who owes the next action, in one readable field. */
  case
    when i.status in ('completed','cancelled') then null
    when cs.work_item_id is null then null
    when cs.owner_kind = 'profile' then 'profile:' || cs.owner_profile_id::text
    when cs.owner_kind = 'persona' then 'persona:' || cs.owner_persona::text
    else cs.owner_kind::text
  end as owner,
  cs.owner_kind as current_owner_kind,
  cs.owner_persona as current_owner_persona,
  cs.owner_profile_id as current_owner_profile_id,
  /* Why it is waiting, stated rather than inferred from a status. */
  case
    when i.status = 'completed' then 'finished'
    when i.status = 'cancelled' then 'cancelled'
    when i.status = 'failed' then coalesce('failed: ' || i.failure, 'failed')
    when cs.status = 'failed' then coalesce('step failed: ' || cs.failure, 'step failed')
    when cs.status = 'escalated' then 'escalated past its deadline'
    when cs.item_type in ('human','approval') and cs.status = 'claimed'
      then 'with the person who took it'
    when cs.item_type in ('human','approval')
      then 'waiting for a ' || coalesce(cs.owner_persona::text, 'person')
    when cs.handler = 'await_domain_state' and cs.subject_id is null
         and btg.check_requires_subject(cs.completion_check)
      then 'waiting to be told which record it concerns'
    when cs.handler = 'await_domain_state'
      then 'waiting for ' || coalesce(cs.completion_check, 'the domain')
    when cs.handler = 'domain_command'
      then 'queued to run ' || coalesce(cs.domain_command, 'a command')
    when cs.work_item_id is null then 'nothing left to do'
    else 'queued'
  end as waiting_on,
  ns.step_key as next_step,
  ns.ordinal as next_step_ordinal,
  /* The domain entity this step concerns -- never a copy of it. */
  cs.subject_type,
  cs.subject_id,
  cs.deadline_at,
  (cs.deadline_at is not null and cs.deadline_at < now()) as overdue,
  (cs.deadline_at is not null and cs.deadline_at >= now()
     and cs.deadline_at < now() + interval '12 hours') as sla_at_risk,
  btg.last_event_at(i.id) as last_event_at
from public.workflow_instances i
join public.workflow_definition_versions v on v.id = i.definition_version_id
join public.workflow_definitions d on d.id = v.definition_id
left join steps st on st.workflow_instance_id = i.id
left join current_step cs on cs.workflow_instance_id = i.id
left join next_step ns on ns.workflow_instance_id = i.id;

grant select on public.workflow_instance_view to authenticated, service_role;

-- --------------------------------------------------- 2. what happened, in order ---
/* Definer semantics on purpose: btg.orchestration_events is service_role only,
   so an invoker view would be empty for every caller. The authorization is
   inlined instead, and an operator is the only caller who sees anything. */
create or replace view public.workflow_timeline_view as
select
  e.workflow_instance_id,
  e.occurred_at,
  'orchestration'::text as source,
  e.event_type::text as event,
  e.step_key,
  e.work_item_id::text as object_id,
  e.attempt,
  e.source as emitted_by,
  e.payload as detail
from btg.orchestration_events e
where btg.is_operator()
union all
select
  i.id as workflow_instance_id,
  a.occurred_at,
  'evidence'::text as source,
  a.action as event,
  null::text as step_key,
  a.object_id,
  0 as attempt,
  coalesce(a.metadata->>'actor', 'session') as emitted_by,
  a.after as detail
from public.audit_events a
join public.workflow_instances i
  on i.id::text = a.object_id
     or (a.metadata ? 'subject' and (a.metadata->>'subject')::uuid = i.subject_profile_id
         and a.occurred_at >= i.created_at
         and (i.settled_at is null or a.occurred_at <= i.settled_at))
where btg.is_operator()
  and a.action like 'workflow.%';

grant select on public.workflow_timeline_view to authenticated, service_role;

-- ------------------------------------------------- 3. every piece of work ---
/* The operator-wide queue. security_invoker, so the work-item policy decides:
   an operator sees everything, a persona holder sees what they may act on, a
   learner sees their own run's items. */
create or replace view public.workflow_work_queue_view
with (security_invoker = true) as
select
  w.id as work_item_id,
  w.workflow_instance_id,
  d.key as workflow,
  w.step_key,
  s.ordinal as step_ordinal,
  w.item_type,
  s.handler,
  w.status,
  w.owner_kind,
  w.owner_persona,
  w.owner_profile_id,
  w.claimed_by,
  w.claimed_at,
  w.lease_until,
  w.priority,
  w.available_at,
  w.deadline_at,
  (w.deadline_at is not null and w.deadline_at < now()) as overdue,
  w.attempts,
  w.max_attempts,
  w.failure,
  w.subject_type,
  w.subject_id,
  i.subject_profile_id,
  i.organization_id,
  i.status as instance_status,
  w.created_at,
  w.updated_at
from public.workflow_work_items w
join public.workflow_instances i on i.id = w.workflow_instance_id
join public.workflow_definition_versions v on v.id = i.definition_version_id
join public.workflow_definitions d on d.id = v.definition_id
join public.workflow_definition_steps s
  on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key;

grant select on public.workflow_work_queue_view to authenticated, service_role;

-- ----------------------------------------------------- 4. what is stuck ---
/* Only the runs that need somebody. A green run does not appear here, which is
   the point: the operator surface is a list of problems, not a dashboard of
   everything. */
create or replace view public.workflow_blockers_view
with (security_invoker = true) as
select
  iv.instance_id,
  iv.workflow,
  iv.workflow_name,
  iv.instance_status,
  iv.subject_profile_id,
  iv.organization_id,
  iv.current_work_item_id,
  iv.current_step,
  iv.current_step_status,
  iv.current_item_type,
  iv.current_handler,
  iv.owner,
  iv.waiting_on,
  iv.current_attempts,
  iv.current_max_attempts,
  iv.current_failure,
  iv.instance_failure,
  iv.deadline_at,
  iv.overdue,
  iv.sla_at_risk,
  iv.subject_type,
  iv.subject_id,
  iv.started_at,
  iv.last_event_at,
  case
    when iv.instance_status = 'failed' then 'run_failed'
    when iv.current_step_status = 'failed' then 'step_failed'
    when iv.current_step_status = 'escalated' then 'escalated'
    when iv.overdue then 'past_deadline'
    when iv.current_attempts >= 2 then 'retrying'
    when iv.sla_at_risk then 'deadline_close'
    when iv.current_item_type in ('human','approval')
      and iv.current_step_status = 'ready' then 'awaiting_person'
    when iv.last_event_at is not null
      and iv.last_event_at < now() - interval '24 hours' then 'stalled'
    else 'other'
  end as blocker,
  case
    when iv.instance_status = 'failed' then 1
    when iv.current_step_status = 'failed' then 1
    when iv.current_step_status = 'escalated' then 2
    when iv.overdue then 2
    when iv.current_attempts >= 2 then 3
    when iv.sla_at_risk then 4
    else 5
  end as severity
from public.workflow_instance_view iv
where iv.instance_status in ('created','active','waiting','failed')
  and (
    iv.instance_status = 'failed'
    or iv.current_step_status in ('failed','escalated')
    or iv.overdue
    or iv.sla_at_risk
    or iv.current_attempts >= 2
    or (iv.current_item_type in ('human','approval') and iv.current_step_status = 'ready')
    or (iv.last_event_at is not null and iv.last_event_at < now() - interval '24 hours')
  );

grant select on public.workflow_blockers_view to authenticated, service_role;
