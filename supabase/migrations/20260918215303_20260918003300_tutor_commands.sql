-- E7 commands.
--
-- The provider call happens in the application layer, not here. This layer
-- owns what the tutor is allowed to see, what it is allowed to have said, and
-- the record of every turn including refusals. A missing provider key is
-- recorded as provider_unavailable rather than failing silently, so the
-- deterministic path stays testable without a live model.

create or replace function public.open_tutor_session(
  p_step_id uuid default null,
  p_module_id uuid default null
)
returns public.tutor_sessions
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_session public.tutor_sessions;
  v_competency uuid;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  -- The context must be the learner's own, or the tutor sees nothing.
  if p_step_id is not null then
    select s.competency_id into v_competency
    from public.pathway_steps s join public.pathways p on p.id = s.pathway_id
    where s.id = p_step_id and p.profile_id = v_actor;
    if v_competency is null then
      raise exception 'step not found' using errcode = 'P0002';
    end if;
  elsif p_module_id is not null then
    select m.competency_id into v_competency
    from public.learning_modules m
    join public.learner_module_progress lmp on lmp.module_id = m.id
    where m.id = p_module_id and lmp.profile_id = v_actor;
    if v_competency is null then
      raise exception 'module not found for this learner' using errcode = 'P0002';
    end if;
  end if;

  -- Reuse an open session for the same context rather than fragmenting it.
  select * into v_session from public.tutor_sessions
  where profile_id = v_actor
    and coalesce(pathway_step_id::text, '') = coalesce(p_step_id::text, '')
    and coalesce(module_id::text, '') = coalesce(p_module_id::text, '')
    and last_turn_at > now() - interval '12 hours'
  order by last_turn_at desc limit 1;
  if found then return v_session; end if;

  insert into public.tutor_sessions (profile_id, pathway_step_id, module_id, competency_id)
  values (v_actor, p_step_id, p_module_id, v_competency)
  returning * into v_session;

  perform public.record_audit_event(
    'tutor.session.opened', 'tutor_session', v_session.id::text, null, null,
    null, jsonb_build_object('step', p_step_id, 'module', p_module_id),
    'info'::public.btg_audit_severity, null, 'tutor');

  return v_session;
end;
$$;

/* The approved context, assembled server-side. The tutor never receives
   anything a learner has not earned the right to see, and never receives an
   answer key: diagnostic_answer_keys is not readable here by construction. */
create or replace function public.tutor_context(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid(); v_session public.tutor_sessions; v_context jsonb;
begin
  select * into v_session from public.tutor_sessions where id = p_session_id;
  if v_actor is null or not found or v_session.profile_id <> v_actor then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'competency', (select jsonb_build_object('name', c.name, 'description', c.description,
                                             'target_level', c.target_level)
                   from public.competencies c where c.id = v_session.competency_id),
    'measured_level', (select lc.level from public.learner_competencies lc
                       where lc.profile_id = v_actor and lc.competency_id = v_session.competency_id),
    'step', (select jsonb_build_object('position', s.position, 'status', s.status,
                                       'from_level', s.from_level, 'target_level', s.target_level,
                                       'rationale', s.rationale)
             from public.pathway_steps s where s.id = v_session.pathway_step_id),
    'module', (select jsonb_build_object('title', m.title, 'summary', m.summary)
               from public.learning_modules m where m.id = v_session.module_id),
    'activities_completed', (select count(*) from public.learner_activity_completions lac
                             join public.learning_activities a on a.id = lac.activity_id
                             where lac.profile_id = v_actor and a.module_id = v_session.module_id),
    'goal', (select primary_goal from public.learner_profiles where profile_id = v_actor)
  ) into v_context;

  return v_context;
end;
$$;

/* Records a turn. The application layer decides what the tutor said; this
   records it with the governance metadata, and rejects a shape that claims
   something the tutor is not permitted to claim. */
create or replace function public.record_tutor_turn(
  p_session_id uuid,
  p_intent public.btg_tutor_intent,
  p_learner_message text,
  p_outcome public.btg_tutor_outcome,
  p_policy_version text,
  p_instruction_version text,
  p_tutor_response text default null,
  p_model text default null,
  p_refusal_reason text default null,
  p_latency_ms integer default null
)
returns public.tutor_turns
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_session public.tutor_sessions;
  v_ordinal smallint;
  v_turn public.tutor_turns;
begin
  select * into v_session from public.tutor_sessions where id = p_session_id for update;
  if v_actor is null or not found or v_session.profile_id <> v_actor then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  select coalesce(max(ordinal), 0) + 1 into v_ordinal from public.tutor_turns where session_id = p_session_id;

  insert into public.tutor_turns (
    session_id, profile_id, ordinal, intent, learner_message, tutor_response, outcome,
    policy_version, instruction_version, model, refusal_reason, latency_ms
  ) values (
    p_session_id, v_actor, v_ordinal, p_intent, btrim(p_learner_message), p_tutor_response, p_outcome,
    p_policy_version, p_instruction_version, p_model, p_refusal_reason, p_latency_ms
  )
  returning * into v_turn;

  update public.tutor_sessions
  set turn_count = turn_count + 1, last_turn_at = now()
  where id = p_session_id;

  -- A refusal is a material governance event; a delivered turn is routine.
  perform public.record_audit_event(
    'tutor.turn.' || p_outcome::text, 'tutor_turn', v_turn.id::text, null, null,
    null,
    jsonb_build_object('intent', p_intent, 'policy_version', p_policy_version,
                       'instruction_version', p_instruction_version, 'model', p_model,
                       'refusal_reason', p_refusal_reason),
    case when p_outcome = 'delivered' then 'info' else 'notice' end::public.btg_audit_severity,
    null, 'tutor');

  return v_turn;
end;
$$;

do $$ declare fn text;
begin
  foreach fn in array array[
    'public.open_tutor_session(uuid, uuid)',
    'public.tutor_context(uuid)',
    'public.record_tutor_turn(uuid, public.btg_tutor_intent, text, public.btg_tutor_outcome, text, text, text, text, text, integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
