-- E5 commands. Generation is deterministic: prerequisite depth first, then the
-- widest gap, then catalogue order. No model involved, so the plan can be
-- explained line by line and reproduced from the same baseline.

create or replace function public.generate_pathway(p_correlation_id uuid default null)
returns public.pathways
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_prev public.pathways;
  v_pathway public.pathways;
  v_attempt uuid;
  v_version smallint;
  v_count int;
  v_step record;
  v_position smallint := 0;
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
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

  perform public.record_audit_event(
    'pathway.pathway.generated', 'pathway', v_pathway.id::text, null, null,
    case when v_prev.id is null then null else jsonb_build_object('previous_version', v_prev.version) end,
    v_pathway.rationale, 'notice'::public.btg_audit_severity, p_correlation_id, 'pathway_generation'
  );

  perform public.enqueue_notification(
    v_actor, 'pathway.generated', 'Your pathway is ready',
    'pathway.generated:' || v_pathway.id::text,
    format('%s steps, ordered so nothing arrives before its prerequisites.', v_count),
    '/pathway'
  );

  return v_pathway;
end;
$$;

-- Unlocking is derived, never client-asserted: a step becomes available when
-- every step it depends on inside this pathway is completed or skipped.
create or replace function btg.refresh_pathway_unlocks(p_pathway_id uuid)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
begin
  update public.pathway_steps s set status = 'available', unlocked_at = coalesce(s.unlocked_at, now())
  where s.pathway_id = p_pathway_id
    and s.status = 'locked'
    and not exists (
      select 1 from public.pathway_step_dependencies d
      join public.pathway_steps dep on dep.id = d.depends_on_step_id
      where d.step_id = s.id and dep.status not in ('completed','skipped')
    );
end;
$$;

create or replace function public.start_pathway_step(p_step_id uuid)
returns public.pathway_steps
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_step public.pathway_steps;
begin
  select s.* into v_step from public.pathway_steps s
  join public.pathways p on p.id = s.pathway_id
  where s.id = p_step_id and p.profile_id = v_actor and p.status = 'active'
  for update of s;
  if v_actor is null or not found then
    raise exception 'step not found' using errcode = 'P0002';
  end if;
  if v_step.status <> 'available' then
    raise exception 'this step is not available yet' using errcode = 'check_violation';
  end if;

  update public.pathway_steps set status = 'in_progress', started_at = coalesce(started_at, now())
  where id = p_step_id returning * into v_step;

  perform public.record_audit_event(
    'pathway.step.started', 'pathway_step', p_step_id::text, null, null,
    jsonb_build_object('status', 'available'), jsonb_build_object('status', 'in_progress'),
    'info'::public.btg_audit_severity, null, 'pathway'
  );
  return v_step;
end;
$$;

/* Completion is driven by learning and evidence, so it is internal: no route
   may mark a step complete directly. */
create or replace function btg.complete_pathway_step(p_step_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_step public.pathway_steps;
  v_remaining int;
begin
  select * into v_step from public.pathway_steps where id = p_step_id for update;
  if not found or v_step.status = 'completed' then
    return;
  end if;
  if v_step.status = 'available' then
    update public.pathway_steps set status = 'in_progress', started_at = coalesce(started_at, now())
    where id = p_step_id;
  end if;

  update public.pathway_steps set status = 'completed', completed_at = now() where id = p_step_id;

  perform btg.refresh_pathway_unlocks(v_step.pathway_id);

  perform public.record_audit_event(
    'pathway.step.completed', 'pathway_step', p_step_id::text, null, null,
    null, jsonb_build_object('reason', p_reason),
    'notice'::public.btg_audit_severity, null, 'pathway'
  );

  select count(*) into v_remaining from public.pathway_steps
  where pathway_id = v_step.pathway_id and status not in ('completed','skipped');

  if v_remaining = 0 then
    perform btg.notify(
      (select profile_id from public.pathways where id = v_step.pathway_id),
      'pathway.completed', 'You finished your pathway',
      'pathway.completed:' || v_step.pathway_id::text,
      'Every step is closed. Re-run your baseline to measure the change.',
      '/pathway'
    );
  end if;
end;
$$;

create or replace view public.pathway_step_view
with (security_invoker = true) as
select s.id, s.pathway_id, p.profile_id, s.position, s.status, s.from_level, s.target_level,
       s.rationale, s.depth, s.unlocked_at, s.started_at, s.completed_at,
       c.id as competency_id, c.slug as competency_slug, c.name as competency_name,
       c.evidence_requirement, d.name as domain_name,
       (select coalesce(array_agg(pc.name order by pc.name), '{}')
        from public.pathway_step_dependencies dep
        join public.pathway_steps ds on ds.id = dep.depends_on_step_id
        join public.competencies pc on pc.id = ds.competency_id
        where dep.step_id = s.id and ds.status not in ('completed','skipped')) as blocked_by
from public.pathway_steps s
join public.pathways p on p.id = s.pathway_id
join public.competencies c on c.id = s.competency_id
join public.competency_domains d on d.id = c.domain_id;

grant select on public.pathway_step_view to authenticated, service_role;

do $$ declare fn text;
begin
  foreach fn in array array['public.generate_pathway(uuid)', 'public.start_pathway_step(uuid)'] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
