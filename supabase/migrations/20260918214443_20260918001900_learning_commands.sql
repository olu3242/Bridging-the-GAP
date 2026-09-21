-- E6 commands + the pathway-step completion rule.
-- A step closes when its learning is done. Batch 3 replaces this helper with
-- the full rule (learning AND verified evidence where the competency requires
-- it); it is defined here so learning is usable before verification exists.

create or replace function btg.maybe_complete_pathway_step(p_step_id uuid)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_open int;
begin
  if p_step_id is null then return; end if;

  select count(*) into v_open
  from public.learner_module_progress lmp
  where lmp.pathway_step_id = p_step_id and lmp.status <> 'completed';

  if v_open = 0 then
    perform btg.complete_pathway_step(p_step_id, 'learning_complete');
  end if;
end;
$$;

/* Enrols the learner in every published module for a step's competency and
   returns the step. Idempotent. */
create or replace function public.open_step_learning(p_step_id uuid)
returns setof public.learner_module_progress
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_step public.pathway_steps;
begin
  select s.* into v_step from public.pathway_steps s
  join public.pathways p on p.id = s.pathway_id
  where s.id = p_step_id and p.profile_id = v_actor and p.status = 'active';
  if v_actor is null or not found then
    raise exception 'step not found' using errcode = 'P0002';
  end if;
  if v_step.status = 'locked' then
    raise exception 'this step is still locked' using errcode = 'check_violation';
  end if;

  insert into public.learner_module_progress (
    profile_id, module_id, pathway_step_id, status, activities_total
  )
  select v_actor, m.id, p_step_id, 'available',
         (select count(*) from public.learning_activities a where a.module_id = m.id)
  from public.learning_modules m
  where m.competency_id = v_step.competency_id and m.status = 'published'
  on conflict (profile_id, module_id) do update set
    pathway_step_id = coalesce(public.learner_module_progress.pathway_step_id, excluded.pathway_step_id);

  return query
  select * from public.learner_module_progress
  where profile_id = v_actor and pathway_step_id = p_step_id;
end;
$$;

create or replace function public.complete_learning_activity(
  p_activity_id uuid,
  p_output text default null
)
returns public.learner_module_progress
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_activity public.learning_activities;
  v_progress public.learner_module_progress;
  v_done int;
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  select * into v_activity from public.learning_activities where id = p_activity_id;
  if not found then
    raise exception 'activity not found' using errcode = 'P0002';
  end if;
  if v_activity.requires_output and coalesce(btrim(p_output), '') = '' then
    raise exception 'this activity needs your work before it can be completed'
      using errcode = 'check_violation';
  end if;

  select * into v_progress from public.learner_module_progress
  where profile_id = v_actor and module_id = v_activity.module_id for update;
  if not found then
    raise exception 'start this module from your pathway first' using errcode = 'check_violation';
  end if;
  if v_progress.status = 'locked' then
    raise exception 'this module is locked' using errcode = 'check_violation';
  end if;

  insert into public.learner_activity_completions (profile_id, activity_id, output)
  values (v_actor, p_activity_id, nullif(btrim(coalesce(p_output, '')), ''))
  on conflict (profile_id, activity_id) do nothing;

  select count(*) into v_done
  from public.learner_activity_completions lac
  join public.learning_activities a on a.id = lac.activity_id
  where lac.profile_id = v_actor and a.module_id = v_activity.module_id;

  if v_progress.status = 'available' then
    update public.learner_module_progress set status = 'in_progress', started_at = coalesce(started_at, now())
    where profile_id = v_actor and module_id = v_activity.module_id;
  end if;

  update public.learner_module_progress set activities_completed = v_done
  where profile_id = v_actor and module_id = v_activity.module_id
  returning * into v_progress;

  if v_done >= v_progress.activities_total and v_progress.status <> 'completed' then
    update public.learner_module_progress set status = 'completed', completed_at = now()
    where profile_id = v_actor and module_id = v_activity.module_id
    returning * into v_progress;

    perform public.record_audit_event(
      'learning.module.completed', 'learning_module', v_activity.module_id::text, null, null,
      null, jsonb_build_object('activities', v_done),
      'notice'::public.btg_audit_severity, null, 'learning'
    );

    -- Starting the step is implied by completing its learning.
    if v_progress.pathway_step_id is not null then
      update public.pathway_steps set status = 'in_progress', started_at = coalesce(started_at, now())
      where id = v_progress.pathway_step_id and status = 'available';
      perform btg.maybe_complete_pathway_step(v_progress.pathway_step_id);
    end if;
  else
    perform public.record_audit_event(
      'learning.activity.completed', 'learning_activity', p_activity_id::text, null, null,
      null, jsonb_build_object('module_id', v_activity.module_id, 'completed', v_done),
      'info'::public.btg_audit_severity, null, 'learning'
    );
  end if;

  return v_progress;
end;
$$;

create or replace view public.learner_learning_view
with (security_invoker = true) as
select lmp.profile_id, lmp.module_id, lmp.pathway_step_id, lmp.status, lmp.activities_completed,
       lmp.activities_total, lmp.started_at, lmp.completed_at,
       m.slug as module_slug, m.title as module_title, m.summary, m.estimated_minutes,
       m.target_level, c.id as competency_id, c.name as competency_name, c.slug as competency_slug,
       s.position as step_position, s.status as step_status
from public.learner_module_progress lmp
join public.learning_modules m on m.id = lmp.module_id
join public.competencies c on c.id = m.competency_id
left join public.pathway_steps s on s.id = lmp.pathway_step_id;

grant select on public.learner_learning_view to authenticated, service_role;

do $$ declare fn text;
begin
  foreach fn in array array[
    'public.open_step_learning(uuid)',
    'public.complete_learning_activity(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
