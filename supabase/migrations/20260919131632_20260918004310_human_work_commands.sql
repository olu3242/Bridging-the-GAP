-- W14-E — human work: claim, complete, escalate, reassign.
--
-- Separate migration from 004300 because Postgres will not let a new enum
-- value be used in the transaction that added it, and a hosted project applies
-- a migration as one transaction.

-- --------------------------------------------- lifecycle for escalated work ---
insert into btg.state_transitions (machine, from_state, to_state) values
  ('work_item', 'ready', 'escalated'),
  ('work_item', 'claimed', 'escalated'),
  ('work_item', 'escalated', 'claimed'),
  ('work_item', 'escalated', 'ready'),
  ('work_item', 'escalated', 'completed'),
  ('work_item', 'escalated', 'failed'),
  ('work_item', 'escalated', 'cancelled')
on conflict do nothing;

-- ------------------------------------------------- who may claim what work ---
/* Capability, ownership and the one non-configurable rule. A person may claim
   human work only when they hold the persona the step names, and never on a
   run whose subject is themselves -- which is no-self-review, no
   self-approval, no self-verification and no self-progression at once. */
create or replace function btg.assert_claim_allowed(p_item_id uuid, p_claimant uuid)
returns public.workflow_work_items
language plpgsql stable security definer
set search_path = public, btg, pg_temp as $$
declare
  v_item public.workflow_work_items;
  v_instance public.workflow_instances;
begin
  if p_claimant is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  select * into v_item from public.workflow_work_items where id = p_item_id;
  if not found then
    raise exception 'work item not found' using errcode = 'P0002';
  end if;
  select * into v_instance from public.workflow_instances where id = v_item.workflow_instance_id;

  if v_item.item_type not in ('human','approval') then
    raise exception 'a % work item is not a person''s to claim', v_item.item_type
      using errcode = '42501';
  end if;

  -- The rule. Not configurable, not waivable, and it applies to operators too:
  -- an operator reviewing their own evidence is still self-review.
  if v_instance.subject_profile_id = p_claimant then
    raise exception 'nobody may take human work on their own run'
      using errcode = '42501';
  end if;

  if v_item.owner_kind = 'persona' then
    if not (btg.has_platform_persona(v_item.owner_persona) or btg.is_operator()) then
      raise exception 'this work needs the % persona', v_item.owner_persona
        using errcode = '42501';
    end if;
  elsif v_item.owner_kind = 'profile' then
    if v_item.owner_profile_id is distinct from p_claimant then
      raise exception 'work item not found' using errcode = 'P0002';
    end if;
  else
    raise exception '% work is not a person''s to claim', v_item.owner_kind
      using errcode = '42501';
  end if;

  return v_item;
end;
$$;

-- ------------------------------------------------------------- claim/release ---
/* One statement, so two people pressing the button at the same moment cannot
   both hold the item: the status guard is part of the UPDATE. */
create or replace function public.claim_work_item(p_item_id uuid, p_lease_hours integer default 4)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_item public.workflow_work_items;
begin
  v_item := btg.assert_claim_allowed(p_item_id, v_actor);

  if v_item.status = 'claimed' and v_item.owner_profile_id = v_actor then
    return v_item;  -- idempotent: already mine
  end if;

  update public.workflow_work_items
  set status = 'claimed', owner_profile_id = v_actor, claimed_at = now(),
      claimed_by = v_actor::text,
      lease_until = now() + make_interval(hours => greatest(least(p_lease_hours, 72), 1))
  where id = p_item_id
    and status in ('ready','escalated')
    and claimed_by is null
  returning * into v_item;

  if not found then
    raise exception 'that work is already taken' using errcode = '42501';
  end if;

  perform btg.emit_orchestration_event(
    v_item.workflow_instance_id, 'claimed_by_person', p_item_id, v_item.step_key,
    jsonb_build_object('owner', v_actor, 'lease_until', v_item.lease_until),
    v_item.attempts, 'app');

  return v_item;
end;
$$;

create or replace function public.release_work_item(p_item_id uuid)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid(); v_item public.workflow_work_items;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  update public.workflow_work_items
  set status = 'ready', owner_profile_id = null, claimed_at = null,
      claimed_by = null, lease_until = null
  where id = p_item_id and status = 'claimed' and claimed_by = v_actor::text
  returning * into v_item;

  if not found then
    raise exception 'that work is not yours to release' using errcode = '42501';
  end if;

  perform btg.emit_orchestration_event(
    v_item.workflow_instance_id, 'released_by_person', p_item_id, v_item.step_key,
    jsonb_build_object('by', v_actor), v_item.attempts, 'app');

  return v_item;
end;
$$;

-- -------------------------------------------------------------- completion ---
/* This does NOT decide, approve, verify or issue anything. The person already
   did the real thing through the governed engine command in their own session;
   this asks the runtime to notice, and btg.complete_work_item refuses unless
   the domain shows it. A reviewer who claims the item and completes it without
   deciding the review gets a refusal, not a verified skill. */
create or replace function public.complete_my_work_item(
  p_item_id uuid,
  p_result jsonb default '{}'::jsonb
)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_item public.workflow_work_items;
  v_dispatch record;
  v_pass integer;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  select * into v_item from public.workflow_work_items where id = p_item_id for update;
  if not found then raise exception 'work item not found' using errcode = 'P0002'; end if;
  if v_item.status = 'completed' then return v_item; end if;  -- idempotent
  if v_item.claimed_by is distinct from v_actor::text then
    raise exception 'claim that work before completing it' using errcode = '42501';
  end if;

  v_item := btg.complete_work_item(p_item_id, coalesce(p_result, '{}'::jsonb));
  perform btg.enqueue_ready_steps(v_item.workflow_instance_id);

  /* Carry the run on from here. The person who just did the work is the one
     authorized on it, and the next steps are system steps the dispatcher
     re-verifies against the domain -- so the learner does not have to come
     back and press something for their own workflow to move. Bounded to two
     passes; the invoker picks up anything left. */
  for v_pass in 1..2 loop
    select * into v_dispatch from btg.dispatch_workflow_work(
      'app:' || v_actor::text, 10, 60, v_item.workflow_instance_id);
    exit when coalesce(v_dispatch.claimed, 0) = 0;
  end loop;

  select * into v_item from public.workflow_work_items where id = p_item_id;
  return v_item;
end;
$$;

-- -------------------------------------------------- escalation and handover ---
create or replace function btg.escalate_work_item(p_item_id uuid, p_reason text)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_item public.workflow_work_items; v_admin record;
begin
  select * into v_item from public.workflow_work_items where id = p_item_id for update;
  if not found then raise exception 'work item not found' using errcode = 'P0002'; end if;
  if v_item.status not in ('ready','claimed') then return v_item; end if;

  update public.workflow_work_items
  set status = 'escalated', owner_kind = 'persona', owner_persona = 'operator',
      owner_profile_id = null, claimed_at = null, claimed_by = null, lease_until = null,
      priority = greatest(1, priority - 50)
  where id = p_item_id
  returning * into v_item;

  perform btg.emit_orchestration_event(
    v_item.workflow_instance_id, 'escalated', p_item_id, v_item.step_key,
    jsonb_build_object('reason', p_reason, 'deadline_at', v_item.deadline_at),
    v_item.attempts, 'sla');

  -- Escalation is the one persona queue that pushes: an operator has to know.
  for v_admin in
    select pg.profile_id from public.persona_grants pg
    where pg.persona = 'operator' and pg.status = 'active'
  loop
    perform btg.notify(
      v_admin.profile_id, 'workflow.escalated', 'Work passed its deadline',
      'workflow.escalated:' || p_item_id::text,
      coalesce(p_reason, 'A step needs attention.'), '/console/workflows');
  end loop;

  return v_item;
end;
$$;

/* The SLA sweep. Human work is never queued -- nothing polls a person -- so
   overdue work is found rather than dispatched. */
create or replace function btg.escalate_overdue_work(p_limit integer default 50)
returns integer language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_item record; v_count integer := 0;
begin
  for v_item in
    select w.id from public.workflow_work_items w
    join public.workflow_instances i on i.id = w.workflow_instance_id
    where w.item_type in ('human','approval')
      and w.status in ('ready','claimed')
      and w.deadline_at is not null and w.deadline_at < now()
      and i.status in ('active','waiting')
    order by w.deadline_at
    limit greatest(coalesce(p_limit, 50), 1)
  loop
    perform btg.escalate_work_item(v_item.id, 'deadline passed');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

/* Operator-triggered, so the control plane can run the sweep rather than
   waiting for a scheduler this environment cannot deploy. */
create or replace function public.escalate_overdue_work(p_limit integer default 50)
returns integer language plpgsql security definer
set search_path = public, btg, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not btg.is_operator() then
    raise exception 'only an operator may run the escalation sweep' using errcode = '42501';
  end if;
  return btg.escalate_overdue_work(p_limit);
end;
$$;

create or replace function public.reassign_work_item(p_item_id uuid, p_to_profile uuid)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_item public.workflow_work_items;
  v_instance public.workflow_instances;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not btg.is_operator() then
    raise exception 'only an operator may reassign work' using errcode = '42501';
  end if;

  select * into v_item from public.workflow_work_items where id = p_item_id for update;
  if not found then raise exception 'work item not found' using errcode = 'P0002'; end if;
  if v_item.item_type not in ('human','approval') then
    raise exception 'only a person''s work can be reassigned' using errcode = '42501';
  end if;
  if v_item.status not in ('ready','claimed','escalated') then
    raise exception 'a % work item cannot be reassigned', v_item.status
      using errcode = 'check_violation';
  end if;

  select * into v_instance from public.workflow_instances where id = v_item.workflow_instance_id;
  -- Reassignment cannot be used to route work around the self-review rule.
  if v_instance.subject_profile_id = p_to_profile then
    raise exception 'nobody may be assigned human work on their own run'
      using errcode = '42501';
  end if;
  if v_item.owner_kind = 'persona'
     and not exists (select 1 from public.persona_grants pg
                     where pg.profile_id = p_to_profile
                       and pg.persona = v_item.owner_persona and pg.status = 'active') then
    raise exception 'that person does not hold the % persona', v_item.owner_persona
      using errcode = '42501';
  end if;

  update public.workflow_work_items
  set owner_kind = 'profile', owner_profile_id = p_to_profile,
      status = 'ready', claimed_at = null, claimed_by = null, lease_until = null
  where id = p_item_id
  returning * into v_item;

  perform btg.emit_orchestration_event(
    v_item.workflow_instance_id, 'reassigned', p_item_id, v_item.step_key,
    jsonb_build_object('by', v_actor, 'to', p_to_profile), v_item.attempts, 'operator');

  perform btg.notify(
    p_to_profile, 'workflow.assigned', 'Work was assigned to you',
    'workflow.assigned:' || p_item_id::text,
    'An operator passed this to you.', '/review');

  return v_item;
end;
$$;

-- ------------------------------------------------------------ the queue view ---
/* The persona queues, as one projection the existing dashboards read. A
   persona queue is a pull surface: unclaimed work is listed, not pushed, so
   forty reviewers do not get forty notifications for one piece of evidence.
   Assignment and escalation do notify, because those name a person. */
create or replace view public.my_work_queue
with (security_invoker = true) as
select
  w.id as work_item_id,
  w.workflow_instance_id,
  d.key as workflow,
  d.name as workflow_name,
  w.step_key,
  s.ordinal as step_ordinal,
  w.item_type,
  w.status,
  w.owner_kind,
  w.owner_persona,
  w.owner_profile_id,
  w.priority,
  w.available_at,
  w.deadline_at,
  (w.deadline_at is not null and w.deadline_at < now()) as overdue,
  w.attempts,
  w.subject_type,
  w.subject_id,
  i.subject_profile_id,
  i.organization_id,
  -- coalesce: an unclaimed row has a null claimed_by, and `null = x` is null,
  -- which a UI would have to special-case for no reason.
  coalesce(w.claimed_by = auth.uid()::text, false) as mine,
  s.completion_check,
  w.created_at
from public.workflow_work_items w
join public.workflow_instances i on i.id = w.workflow_instance_id
join public.workflow_definition_versions v on v.id = i.definition_version_id
join public.workflow_definitions d on d.id = v.definition_id
join public.workflow_definition_steps s
  on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
where w.item_type in ('human','approval')
  and w.status in ('ready','claimed','escalated')
  and i.status in ('active','waiting')
  -- Never your own run: the queue does not even show work you could not take.
  and i.subject_profile_id is distinct from auth.uid()
  and (
    (w.owner_kind = 'profile' and w.owner_profile_id = auth.uid())
    or (w.owner_kind = 'persona'
        and (btg.has_platform_persona(w.owner_persona) or btg.is_operator()))
  );

grant select on public.my_work_queue to authenticated, service_role;

-- --------------------------------------------------------------- grants ---
do $$ declare fn text;
begin
  foreach fn in array array[
    'btg.assert_claim_allowed(uuid, uuid)',
    'btg.escalate_work_item(uuid, text)',
    'btg.escalate_overdue_work(integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'public.claim_work_item(uuid, integer)',
    'public.release_work_item(uuid)',
    'public.complete_my_work_item(uuid, jsonb)',
    'public.reassign_work_item(uuid, uuid)',
    'public.escalate_overdue_work(integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- ------------------------------------------- human handlers are resolvable ---
update btg.workflow_handlers
set is_resolvable = true,
    description = 'A person''s work. The dispatcher parks it and waits; a claim and a governed engine command complete it.'
where handler = 'human_review';

update btg.workflow_handlers
set is_resolvable = true,
    description = 'A person''s decision. Parked for the persona that owns it.'
where handler = 'approval';
