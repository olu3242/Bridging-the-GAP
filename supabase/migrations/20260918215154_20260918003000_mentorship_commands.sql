-- E13 commands. Recommendations are computed from persisted learner state and
-- carry the factors that produced them.

/* Mentors a learner should talk to, ranked by how well their expertise covers
   the learner's open pathway steps. Explainable: the factors come back with
   the row. */
create or replace function public.recommend_mentors(p_limit int default 5)
returns table (
  mentor_profile_id uuid,
  mentor_name text,
  headline text,
  monthly_capacity smallint,
  covered_competencies text[],
  covered_count int,
  open_step_count int,
  rationale text
)
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid(); v_open int;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  select count(*) into v_open
  from public.pathway_steps s
  join public.pathways p on p.id = s.pathway_id
  where p.profile_id = v_actor and p.status = 'active' and s.status in ('available','in_progress');

  return query
  with open_steps as (
    select s.competency_id
    from public.pathway_steps s
    join public.pathways p on p.id = s.pathway_id
    where p.profile_id = v_actor and p.status = 'active'
      and s.status in ('available','in_progress')
  ),
  scored as (
    select mp.profile_id, pr.display_name, mp.headline, mp.monthly_capacity,
           array_agg(c.name order by c.name) as covered,
           count(*)::int as covered_count
    from public.mentor_profiles mp
    join public.profiles pr on pr.id = mp.profile_id
    join public.mentor_expertise me on me.profile_id = mp.profile_id
    join public.competencies c on c.id = me.competency_id
    join open_steps os on os.competency_id = me.competency_id
    where mp.is_accepting and mp.monthly_capacity > 0
      and mp.profile_id <> v_actor
      and not exists (
        select 1 from public.mentorships m
        where m.mentor_profile_id = mp.profile_id and m.learner_profile_id = v_actor
          and m.status in ('requested','accepted','active')
      )
    group by mp.profile_id, pr.display_name, mp.headline, mp.monthly_capacity
  )
  select s.profile_id, s.display_name, s.headline, s.monthly_capacity,
         s.covered, s.covered_count, v_open,
         format('Covers %s of your %s open pathway steps: %s.',
                s.covered_count, v_open, array_to_string(s.covered, ', '))
  from scored s
  order by s.covered_count desc, s.monthly_capacity desc
  limit greatest(coalesce(p_limit, 5), 1);
end;
$$;

create or replace function public.request_mentorship(
  p_mentor_profile_id uuid,
  p_competency_id uuid default null,
  p_message text default null
)
returns public.mentorships
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_mentor public.mentor_profiles;
  v_mentorship public.mentorships;
  v_covered text[];
  v_active int;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_mentor_profile_id = v_actor then
    raise exception 'you cannot mentor yourself' using errcode = 'check_violation';
  end if;

  select * into v_mentor from public.mentor_profiles where profile_id = p_mentor_profile_id;
  if not found then raise exception 'mentor not found' using errcode = 'P0002'; end if;
  if not v_mentor.is_accepting or v_mentor.monthly_capacity = 0 then
    raise exception 'this mentor is not accepting requests right now' using errcode = 'check_violation';
  end if;

  select count(*) into v_active from public.mentorships
  where mentor_profile_id = p_mentor_profile_id and status in ('accepted','active');
  if v_active >= v_mentor.monthly_capacity then
    raise exception 'this mentor is at capacity' using errcode = 'check_violation';
  end if;

  select array_agg(c.name order by c.name) into v_covered
  from public.mentor_expertise me
  join public.competencies c on c.id = me.competency_id
  join public.pathway_steps s on s.competency_id = me.competency_id
  join public.pathways p on p.id = s.pathway_id
  where me.profile_id = p_mentor_profile_id and p.profile_id = v_actor
    and p.status = 'active' and s.status in ('available','in_progress');

  insert into public.mentorships (
    mentor_profile_id, learner_profile_id, competency_id, status, rationale, learner_message
  ) values (
    p_mentor_profile_id, v_actor, p_competency_id, 'requested',
    jsonb_build_object('covered_competencies', to_jsonb(coalesce(v_covered, '{}')),
                       'source', 'open_pathway_steps'),
    nullif(btrim(coalesce(p_message, '')), '')
  )
  returning * into v_mentorship;

  perform public.record_audit_event(
    'mentorship.mentorship.requested', 'mentorship', v_mentorship.id::text, null, null,
    null, jsonb_build_object('mentor', p_mentor_profile_id, 'covered', to_jsonb(coalesce(v_covered, '{}'))),
    'info'::public.btg_audit_severity, null, 'mentorship');

  perform btg.notify(
    p_mentor_profile_id, 'mentorship.requested', 'A learner asked you to mentor them',
    'mentorship.requested:' || v_mentorship.id::text,
    'They have open pathway steps your expertise covers.', '/mentorship');

  return v_mentorship;
end;
$$;

create or replace function public.respond_to_mentorship(
  p_mentorship_id uuid,
  p_accept boolean,
  p_response text default null
)
returns public.mentorships
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid(); v_mentorship public.mentorships;
begin
  select * into v_mentorship from public.mentorships where id = p_mentorship_id for update;
  if v_actor is null or not found or v_mentorship.mentor_profile_id <> v_actor then
    raise exception 'mentorship not found' using errcode = 'P0002';
  end if;
  if v_mentorship.status <> 'requested' then
    raise exception 'this request has already been answered' using errcode = 'check_violation';
  end if;

  update public.mentorships
  set status = (case when p_accept then 'accepted' else 'declined' end)::public.btg_mentorship_status,
      responded_at = now(),
      mentor_response = nullif(btrim(coalesce(p_response, '')), '')
  where id = p_mentorship_id
  returning * into v_mentorship;

  perform public.record_audit_event(
    case when p_accept then 'mentorship.mentorship.accepted' else 'mentorship.mentorship.declined' end,
    'mentorship', p_mentorship_id::text, null, 'mentor',
    jsonb_build_object('status', 'requested'),
    jsonb_build_object('status', v_mentorship.status),
    'notice'::public.btg_audit_severity, null, 'mentorship');

  perform btg.notify(
    v_mentorship.learner_profile_id,
    case when p_accept then 'mentorship.accepted' else 'mentorship.declined' end,
    case when p_accept then 'A mentor accepted your request' else 'A mentor could not take you on' end,
    'mentorship.responded:' || p_mentorship_id::text,
    coalesce(v_mentorship.mentor_response, ''), '/mentorship');

  return v_mentorship;
end;
$$;

do $$ declare fn text;
begin
  foreach fn in array array[
    'public.recommend_mentors(int)',
    'public.request_mentorship(uuid, uuid, text)',
    'public.respond_to_mentorship(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
