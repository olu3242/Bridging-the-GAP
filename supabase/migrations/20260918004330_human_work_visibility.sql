-- W14-E, second pass: three defects the human-work tests found.
--
-- 24. A reviewer could not SEE the work assigned to their persona. The work
--     item policy keyed on `owner_profile_id = auth.uid() or can_read_instance`
--     -- and a persona-owned unclaimed item has no owner profile, while the
--     instance belongs to a learner the reviewer cannot read. So the queue was
--     empty for exactly the person it was for. The definition catalog blocked
--     it a second time: my_work_queue is security_invoker and joins the
--     catalog, whose policy only admitted the runs a caller subjects.
--
-- 25. A human step never learned which entity it concerned.
--     btg.signal_workflow_subject only bound await_domain_state steps, so a
--     reviewer_decision item reached the reviewer with no evidence attached and
--     its completion check refused to run at all.
--
-- 26. Reassignment violated work_item_persona_owner: it set owner_kind to
--     'profile' while leaving owner_persona set.

-- ------------------------------------------------- 24. work you may act on ---
/* Answered outside RLS, so a policy never reads a table whose policy reads it
   back. The rule is the same one assert_claim_allowed enforces on the write
   side, which is the point: you can see exactly the work you could take. */
create or replace function btg.may_act_on_item(p_item_id uuid)
returns boolean language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select exists (
    select 1
    from public.workflow_work_items w
    join public.workflow_instances i on i.id = w.workflow_instance_id
    where w.id = p_item_id
      and w.item_type in ('human','approval')
      and i.status in ('active','waiting')
      -- never your own run
      and i.subject_profile_id is distinct from auth.uid()
      and (
        (w.owner_kind = 'profile' and w.owner_profile_id = auth.uid())
        or (w.owner_kind = 'persona'
            and (btg.has_platform_persona(w.owner_persona) or btg.is_operator()))
      )
  );
$$;

create or replace function btg.may_see_version(p_version uuid)
returns boolean language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select btg.is_operator()
     or btg.runs_version(p_version)
     or exists (
       select 1
       from public.workflow_work_items w
       join public.workflow_instances i on i.id = w.workflow_instance_id
       where i.definition_version_id = p_version
         and w.item_type in ('human','approval')
         and i.status in ('active','waiting')
         and i.subject_profile_id is distinct from auth.uid()
         and (
           (w.owner_kind = 'profile' and w.owner_profile_id = auth.uid())
           or (w.owner_kind = 'persona'
               and (btg.has_platform_persona(w.owner_persona) or btg.is_operator()))
         )
     );
$$;

create or replace function btg.may_see_definition(p_definition uuid)
returns boolean language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select btg.is_operator()
     or btg.runs_definition(p_definition)
     or exists (
       select 1 from public.workflow_definition_versions v
       where v.definition_id = p_definition and btg.may_see_version(v.id)
     );
$$;

do $$ declare fn text;
begin
  foreach fn in array array[
    'btg.may_act_on_item(uuid)',
    'btg.may_see_version(uuid)',
    'btg.may_see_definition(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

drop policy if exists work_items_select on public.workflow_work_items;
create policy work_items_select on public.workflow_work_items
  for select to authenticated using (
    owner_profile_id = auth.uid()
    or btg.can_read_instance(workflow_instance_id)
    or btg.may_act_on_item(id)
  );

/* The instance behind work you may act on, and nothing more of it than the
   row: a reviewer needs to know which run a decision belongs to. */
drop policy if exists workflow_instances_select on public.workflow_instances;
create policy workflow_instances_select on public.workflow_instances
  for select to authenticated using (
    subject_profile_id = auth.uid()
    or btg.is_operator()
    or (organization_id is not null
        and organization_id in (select btg.governed_org_ids()))
    or exists (select 1 from public.workflow_work_items w
               where w.workflow_instance_id = id and btg.may_act_on_item(w.id))
  );

drop policy if exists workflow_definitions_select on public.workflow_definitions;
create policy workflow_definitions_select on public.workflow_definitions
  for select to authenticated using (btg.may_see_definition(id));

drop policy if exists workflow_versions_select on public.workflow_definition_versions;
create policy workflow_versions_select on public.workflow_definition_versions
  for select to authenticated using (btg.may_see_version(id));

drop policy if exists workflow_steps_select on public.workflow_definition_steps;
create policy workflow_steps_select on public.workflow_definition_steps
  for select to authenticated using (btg.may_see_version(definition_version_id));

-- ----------------------------------- 25. a signal binds a human step too ---
/* Binding names the entity a step concerns; enqueueing asks a worker to run
   it. Those are different, and conflating them left human steps unbound. A
   human step is bound and left alone -- nothing polls a person. */
create or replace function btg.signal_workflow_subject(
  p_profile uuid,
  p_subject_type text default null,
  p_subject_id uuid default null
)
returns integer language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_item record; v_count integer := 0;
begin
  if p_profile is null then
    raise exception 'a signal is scoped to one subject profile' using errcode = 'check_violation';
  end if;

  for v_item in
    select w.id, w.workflow_instance_id, w.step_key, s.handler, w.status,
           w.subject_type as bound_type, c.requires_subject_type
    from public.workflow_work_items w
    join public.workflow_instances i on i.id = w.workflow_instance_id
    join public.workflow_definition_steps s
      on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
    left join btg.workflow_checks c on c.name = s.completion_check
    /* `pending` is included on purpose: a signal names an entity, and a step
       that has not had its turn yet still concerns it. Binding early means one
       signal is enough for a whole run -- otherwise a human step three steps
       down would reach its owner with nothing attached. Only ready work is
       enqueued below. */
    where w.status in ('pending','ready','claimed','escalated')
      and i.status in ('active','waiting')
      and i.subject_profile_id = p_profile
      and (
        (w.subject_type = p_subject_type and w.subject_id = p_subject_id)
        or (w.subject_type is null and p_subject_type is not null
            and c.requires_subject_type = p_subject_type)
        or (w.subject_type is null and c.requires_subject_type is null
            and s.handler = 'await_domain_state')
      )
  loop
    if v_item.bound_type is null
       and p_subject_id is not null
       and v_item.requires_subject_type = p_subject_type then
      perform btg.bind_work_item_subject(v_item.id, p_subject_type, p_subject_id);
    end if;

    perform btg.emit_orchestration_event(
      v_item.workflow_instance_id, 'signalled', v_item.id, v_item.step_key,
      jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id,
                         'handler', v_item.handler),
      0, 'signal');

    -- A person's work is never queued, and neither is work whose turn has
    -- not come.
    if v_item.handler not in ('human_review','approval')
       and v_item.status in ('ready','claimed') then
      update btg.work_queue
      set available_at = now()
      where queue = 'workflow' and status = 'queued'
        and (payload->>'work_item_id') = v_item.id::text;

      if not exists (
        select 1 from btg.work_queue q
        where q.queue = 'workflow' and q.status in ('queued','claimed')
          and (q.payload->>'work_item_id') = v_item.id::text
      ) then
        perform btg.enqueue_workflow_step(v_item.id, interval '0', 'signal');
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function btg.signal_workflow_subject(uuid, text, uuid) from public;
revoke all on function btg.signal_workflow_subject(uuid, text, uuid) from anon;
revoke all on function btg.signal_workflow_subject(uuid, text, uuid) from authenticated;
grant execute on function btg.signal_workflow_subject(uuid, text, uuid) to service_role;

-- ------------------------------------- 26. reassignment clears the persona ---
create or replace function public.reassign_work_item(p_item_id uuid, p_to_profile uuid)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_item public.workflow_work_items;
  v_instance public.workflow_instances;
  v_persona public.btg_persona;
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

  /* The persona the step asked for is still the bar, whether it is currently
     recorded on the item or was cleared by an earlier reassignment. */
  select coalesce(v_item.owner_persona, s.owner_persona) into v_persona
  from public.workflow_definition_steps s
  where s.definition_version_id = v_instance.definition_version_id
    and s.step_key = v_item.step_key;

  if v_persona is not null
     and not exists (select 1 from public.persona_grants pg
                     where pg.profile_id = p_to_profile
                       and pg.persona = v_persona and pg.status = 'active') then
    raise exception 'that person does not hold the % persona', v_persona
      using errcode = '42501';
  end if;

  update public.workflow_work_items
  set owner_kind = 'profile', owner_profile_id = p_to_profile, owner_persona = null,
      status = 'ready', claimed_at = null, claimed_by = null, lease_until = null
  where id = p_item_id
  returning * into v_item;

  perform btg.emit_orchestration_event(
    v_item.workflow_instance_id, 'reassigned', p_item_id, v_item.step_key,
    jsonb_build_object('by', v_actor, 'to', p_to_profile, 'persona', v_persona),
    v_item.attempts, 'operator');

  perform btg.notify(
    p_to_profile, 'workflow.assigned', 'Work was assigned to you',
    'workflow.assigned:' || p_item_id::text,
    'An operator passed this to you.', '/review');

  return v_item;
end;
$$;

revoke all on function public.reassign_work_item(uuid, uuid) from public;
revoke all on function public.reassign_work_item(uuid, uuid) from anon;
grant execute on function public.reassign_work_item(uuid, uuid) to authenticated, service_role;

-- ---------------------- 27. the instance policy compared a column to itself ---
/* `exists (select 1 from workflow_work_items w where w.workflow_instance_id = id ...)`
   inside a policy on workflow_instances: the unqualified `id` resolved to the
   SUBQUERY's table, which also has an `id`, so the predicate read
   `w.workflow_instance_id = w.id` and was always false. A reviewer could see
   the work item and not the run it belonged to, so every join through
   my_work_queue produced nothing.
   Answered by a definer helper instead, which is both unambiguous and keeps a
   policy from reading a table whose policy reads back. */
create or replace function btg.may_act_on_instance(p_instance uuid)
returns boolean language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select exists (
    select 1
    from public.workflow_work_items w
    join public.workflow_instances i on i.id = w.workflow_instance_id
    where w.workflow_instance_id = p_instance
      and w.item_type in ('human','approval')
      and i.status in ('active','waiting')
      and i.subject_profile_id is distinct from auth.uid()
      and (
        (w.owner_kind = 'profile' and w.owner_profile_id = auth.uid())
        or (w.owner_kind = 'persona'
            and (btg.has_platform_persona(w.owner_persona) or btg.is_operator()))
      )
  );
$$;

revoke all on function btg.may_act_on_instance(uuid) from public;
revoke all on function btg.may_act_on_instance(uuid) from anon;
grant execute on function btg.may_act_on_instance(uuid) to authenticated, service_role;

drop policy if exists workflow_instances_select on public.workflow_instances;
create policy workflow_instances_select on public.workflow_instances
  for select to authenticated using (
    subject_profile_id = auth.uid()
    or btg.is_operator()
    or (organization_id is not null
        and organization_id in (select btg.governed_org_ids()))
    or btg.may_act_on_instance(id)
  );
