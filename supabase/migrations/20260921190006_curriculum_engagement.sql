-- Engagement records are observations, never completion or competency evidence.
create table public.curriculum_engagement (
  profile_id uuid not null references public.profiles(id),
  activity_id uuid not null references public.curriculum_lessons(activity_id),
  kind text not null check(kind in ('viewed','resource_opened')),
  resource_key text not null default '',
  first_at timestamptz not null default now(),
  primary key(profile_id,activity_id,kind,resource_key)
);
alter table public.curriculum_engagement enable row level security;
create policy curriculum_engagement_read on public.curriculum_engagement for select to authenticated
using(profile_id=auth.uid() or btg.is_operator());
grant select on public.curriculum_engagement to authenticated;
grant all on public.curriculum_engagement to service_role;

create function public.record_curriculum_engagement(p_activity_id uuid,p_kind text,p_resource_key text default '') returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
  perform btg.assert_curriculum_access(p_activity_id);
  if p_kind='viewed' and p_resource_key='' then null;
  elsif p_kind='resource_opened' and p_resource_key='video' and exists(
    select 1 from curriculum_lesson_video where activity_id=p_activity_id and video_id is not null
  ) then null;
  else raise exception 'unknown lesson resource or event' using errcode='23514'; end if;
  insert into curriculum_engagement(profile_id,activity_id,kind,resource_key)
  values(auth.uid(),p_activity_id,p_kind,p_resource_key) on conflict do nothing;
end $$;
revoke all on function public.record_curriculum_engagement(uuid,text,text) from public,anon;
grant execute on function public.record_curriculum_engagement(uuid,text,text) to authenticated,service_role;

-- Read the existing playback and completion records; do not duplicate their state.
create function public.curriculum_progress(p_activity_id uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object(
   'last_position',coalesce(p.last_position,lv.start_seconds,0),
   'watched_seconds',coalesce(w.seconds,0),
   'required',lv.required,'threshold',lv.threshold,
   'duration_seconds',coalesce(lv.end_seconds,v.duration_seconds)-coalesce(lv.start_seconds,0),
   'threshold_reached',coalesce(v.health_status='healthy' and lv.relevance_verified_at is not null and
      w.seconds/nullif(coalesce(lv.end_seconds,v.duration_seconds)-coalesce(lv.start_seconds,0),0)>=lv.threshold,false),
   'completed',exists(select 1 from learner_activity_completions c where c.profile_id=auth.uid() and c.activity_id=l.activity_id),
   'viewed',exists(select 1 from curriculum_engagement e where e.profile_id=auth.uid() and e.activity_id=l.activity_id and e.kind='viewed')
 ) from curriculum_lessons l join curriculum_lesson_video lv on lv.activity_id=l.activity_id
 left join curriculum_videos v on v.video_id=lv.video_id
 left join curriculum_playback_progress p on p.activity_id=l.activity_id and p.profile_id=auth.uid()
 left join lateral (select sum(upper(r)-lower(r)) seconds from unnest(p.watched) r) w on true
 where l.activity_id=p_activity_id;
$$;
revoke all on function public.curriculum_progress(uuid) from public,anon;
grant execute on function public.curriculum_progress(uuid) to authenticated,service_role;

create function public.complete_curriculum_lesson(p_activity_id uuid) returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_output text;
begin
  perform btg.assert_curriculum_access(p_activity_id);
  select practice_output into v_output from curriculum_attempts
  where profile_id=auth.uid() and activity_id=p_activity_id and status='evaluated' and passed
  order by attempt_number desc limit 1;
  if not found then raise exception 'passed assessment required' using errcode='23514'; end if;
  -- Existing command and completion trigger remain the authoritative gate.
  perform public.complete_learning_activity(p_activity_id,v_output);
end $$;
revoke all on function public.complete_curriculum_lesson(uuid) from public,anon;
grant execute on function public.complete_curriculum_lesson(uuid) to authenticated,service_role;
