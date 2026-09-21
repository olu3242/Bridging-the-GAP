create table public.curriculum_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  activity_id uuid not null references public.curriculum_lessons(activity_id),
  attempt_number integer not null check(attempt_number between 1 and 3),
  status text not null default 'in_progress' check(status in ('in_progress','submitted','evaluated')),
  practice_output text check(length(practice_output)<=4000),
  selected_option text check(selected_option in ('true','false')),
  created_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  claimed_by uuid references public.profiles(id),
  evaluated_at timestamptz,
  passed boolean,
  rubric_scores jsonb,
  feedback text,
  remediation_acknowledged_at timestamptz,
  unique(profile_id,activity_id,attempt_number),
  check((status='evaluated')=(evaluated_at is not null)),
  check((status='evaluated')=(passed is not null)),
  check(status='in_progress' or (submitted_at is not null and length(btrim(practice_output))>=20 and selected_option is not null)),
  check(claimed_by is null or claimed_by<>profile_id)
);
create unique index curriculum_one_active_attempt on public.curriculum_attempts(profile_id,activity_id) where status='in_progress';
alter table public.curriculum_attempts enable row level security;
create policy curriculum_attempts_read on public.curriculum_attempts for select to authenticated
using(profile_id=auth.uid() or ((btg.is_operator() or btg.has_platform_persona('reviewer')) and status<>'in_progress'));
grant select on public.curriculum_attempts to authenticated;
grant all on public.curriculum_attempts to service_role;
alter table public.learner_activity_completions add column curriculum_attempt_id uuid references public.curriculum_attempts(id);

create table public.curriculum_playback_progress (
  profile_id uuid not null references public.profiles(id),
  activity_id uuid not null references public.curriculum_lessons(activity_id),
  watched nummultirange not null default '{}'::nummultirange,
  last_position numeric not null default 0,
  last_receipt_at timestamptz not null default clock_timestamp(),
  primary key(profile_id,activity_id)
);
create table btg.curriculum_playback_events (
  profile_id uuid not null,
  activity_id uuid not null,
  request_id uuid not null,
  from_seconds numeric not null,
  to_seconds numeric not null,
  primary key(profile_id,activity_id,request_id),
  foreign key(profile_id,activity_id) references public.curriculum_playback_progress(profile_id,activity_id)
);
alter table public.curriculum_playback_progress enable row level security;
create policy curriculum_playback_read on public.curriculum_playback_progress for select to authenticated using(profile_id=auth.uid() or btg.is_operator());
grant select on public.curriculum_playback_progress to authenticated;
grant all on public.curriculum_playback_progress,btg.curriculum_playback_events to service_role;
revoke all on btg.curriculum_playback_events from public,anon,authenticated;

create function btg.assert_curriculum_access(p_activity uuid) returns public.curriculum_lessons
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_lesson public.curriculum_lessons;
begin
  if auth.uid() is null or not btg.has_platform_persona('learner') then raise exception 'learner session required' using errcode='42501'; end if;
  select * into v_lesson from curriculum_lessons where activity_id=p_activity;
  if not found or v_lesson.status<>'published' then raise exception 'published lesson required' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_lesson.contract->'prerequisites') p(code)
    where not exists(select 1 from curriculum_lessons l join learner_activity_completions c on c.activity_id=l.activity_id
      where l.lesson_code=p.code and l.version=v_lesson.version and c.profile_id=auth.uid())) then
    raise exception 'lesson prerequisite is locked' using errcode='23514';
  end if;
  return v_lesson;
end $$;
revoke all on function btg.assert_curriculum_access(uuid) from public,anon,authenticated;

create function public.start_curriculum_attempt(p_activity_id uuid) returns public.curriculum_attempts
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_lesson curriculum_lessons; v_attempt curriculum_attempts; v_count int; v_step uuid;
begin
  v_lesson:=btg.assert_curriculum_access(p_activity_id);
  if not exists(select 1 from profiles where id=auth.uid() and baseline_completed_at is not null) then
    raise exception 'complete your baseline before enrollment' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_activity_id::text,0));
  select * into v_attempt from curriculum_attempts where profile_id=auth.uid() and activity_id=p_activity_id and status='in_progress';
  if found then return v_attempt; end if;
  select * into v_attempt from curriculum_attempts where profile_id=auth.uid() and activity_id=p_activity_id order by attempt_number desc limit 1;
  if found then
    if v_attempt.status='submitted' then raise exception 'your submitted attempt is awaiting review' using errcode='23514'; end if;
    if v_attempt.passed then return v_attempt; end if;
    if v_attempt.remediation_acknowledged_at is null then raise exception 'review the targeted remediation before retrying' using errcode='23514'; end if;
  end if;
  select count(*) into v_count from curriculum_attempts where profile_id=auth.uid() and activity_id=p_activity_id;
  if v_count>=3 then raise exception 'retry limit reached; instructor intervention required' using errcode='23514'; end if;
  select s.id into v_step from pathway_steps s join pathways p on p.id=s.pathway_id
    join learning_modules m on m.competency_id=s.competency_id where p.profile_id=auth.uid() and p.status='active'
      and m.id=v_lesson.module_id and s.status in ('available','in_progress') limit 1;
  insert into learner_module_progress(profile_id,module_id,pathway_step_id,status,activities_total)
    select auth.uid(),v_lesson.module_id,v_step,'available',count(*) from learning_activities where module_id=v_lesson.module_id
    on conflict(profile_id,module_id) do nothing;
  insert into curriculum_attempts(profile_id,activity_id,attempt_number) values(auth.uid(),p_activity_id,v_count+1) returning * into v_attempt;
  perform record_audit_event('curriculum.attempt.started','curriculum_attempt',v_attempt.id::text,null,null,null,
    jsonb_build_object('activity_id',p_activity_id,'attempt',v_count+1),'info'::btg_audit_severity,null,'curriculum');
  return v_attempt;
end $$;

create function public.save_curriculum_attempt(p_attempt_id uuid,p_output text,p_option text,p_submit boolean default false)
returns public.curriculum_attempts language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_attempt curriculum_attempts;
begin
  select * into v_attempt from curriculum_attempts where id=p_attempt_id and profile_id=auth.uid() for update;
  if not found then raise exception 'attempt not found' using errcode='42501'; end if;
  perform btg.assert_curriculum_access(v_attempt.activity_id);
  if v_attempt.status<>'in_progress' then
    if p_submit and v_attempt.practice_output is not distinct from p_output and v_attempt.selected_option is not distinct from p_option then return v_attempt; end if;
    raise exception 'submitted attempts are immutable' using errcode='23514';
  end if;
  if p_output is null or length(p_output)>4000 or (p_option is not null and p_option not in ('true','false')) then
    raise exception 'invalid response' using errcode='23514';
  end if;
  if p_submit and (length(btrim(p_output))<20 or p_option is null) then raise exception 'practice and checkpoint response required' using errcode='23514'; end if;
  update curriculum_attempts set practice_output=p_output,selected_option=p_option,
    status=case when p_submit then 'submitted' else 'in_progress' end,
    submitted_at=case when p_submit then clock_timestamp() else null end where id=p_attempt_id returning * into v_attempt;
  if p_submit then perform record_audit_event('curriculum.attempt.submitted','curriculum_attempt',p_attempt_id::text,null,null,null,
    jsonb_build_object('activity_id',v_attempt.activity_id),'info'::btg_audit_severity,null,'curriculum'); end if;
  return v_attempt;
end $$;

create function public.claim_curriculum_attempt(p_attempt_id uuid) returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_attempt curriculum_attempts;
begin
  if auth.uid() is null or not (btg.is_operator() or btg.has_platform_persona('reviewer')) then raise exception 'reviewer required' using errcode='42501'; end if;
  select * into v_attempt from curriculum_attempts where id=p_attempt_id for update;
  if not found or v_attempt.status<>'submitted' or v_attempt.profile_id=auth.uid() or (v_attempt.claimed_by is not null and v_attempt.claimed_by<>auth.uid()) then
    raise exception 'attempt cannot be claimed' using errcode='42501';
  end if;
  update curriculum_attempts set claimed_by=auth.uid() where id=p_attempt_id;
end $$;

create function public.curriculum_review_rubric(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,btg,pg_temp as $$
declare v_result jsonb;
begin
  if not (btg.is_operator() or btg.has_platform_persona('reviewer')) then raise exception 'reviewer required' using errcode='42501'; end if;
  select k.definition#>'{answers,1,rubric}' into v_result from curriculum_attempts a
    join btg.curriculum_assessment_keys k on k.activity_id=a.activity_id where a.id=p_attempt_id and a.claimed_by=auth.uid() and a.profile_id<>auth.uid();
  if v_result is null then raise exception 'claim this review first' using errcode='42501'; end if;
  return v_result;
end $$;

create function public.evaluate_curriculum_attempt(p_attempt_id uuid,p_scores jsonb,p_feedback text) returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_attempt curriculum_attempts; v_key jsonb; v_criterion jsonb; v_pass boolean; v_score int;
begin
  if auth.uid() is null or not (btg.is_operator() or btg.has_platform_persona('reviewer')) then raise exception 'reviewer required' using errcode='42501'; end if;
  if length(btrim(coalesce(p_feedback,'')))<20 or length(p_feedback)>4000 then raise exception 'specific review feedback required' using errcode='23514'; end if;
  select * into v_attempt from curriculum_attempts where id=p_attempt_id for update;
  if not found or v_attempt.status<>'submitted' or v_attempt.claimed_by is distinct from auth.uid() or v_attempt.profile_id=auth.uid() then
    raise exception 'independent claimed review required' using errcode='42501';
  end if;
  select definition into strict v_key from btg.curriculum_assessment_keys where activity_id=v_attempt.activity_id;
  v_pass:=v_attempt.selected_option=v_key#>>'{answers,0,correct_option}';
  for v_criterion in select value from jsonb_array_elements(v_key#>'{answers,1,rubric}') loop
    if not coalesce((p_scores ? (v_criterion->>'id')) and (p_scores->>(v_criterion->>'id')) ~ '^[0-4]$',false) then
      raise exception 'every rubric criterion needs an integer score from 0 to 4' using errcode='23514';
    end if;
    v_score:=(p_scores->>(v_criterion->>'id'))::int;
    v_pass:=v_pass and v_score>=(v_criterion->>'minimum')::int;
  end loop;
  update curriculum_attempts set status='evaluated',evaluated_at=clock_timestamp(),passed=v_pass,
    rubric_scores=p_scores,feedback=p_feedback where id=p_attempt_id;
  perform record_audit_event('curriculum.attempt.evaluated','curriculum_attempt',p_attempt_id::text,null,null,
    jsonb_build_object('status','submitted'),jsonb_build_object('passed',v_pass,'scores',p_scores,'reason',p_feedback),
    'notice'::btg_audit_severity,null,'curriculum_review');
end $$;

create function public.acknowledge_curriculum_remediation(p_attempt_id uuid) returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
  update curriculum_attempts set remediation_acknowledged_at=coalesce(remediation_acknowledged_at,clock_timestamp())
    where id=p_attempt_id and profile_id=auth.uid() and status='evaluated' and passed=false;
  if not found then raise exception 'failed own attempt required' using errcode='42501'; end if;
end $$;

create function public.begin_curriculum_playback(p_activity_id uuid,p_position numeric default 0) returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_end numeric; v_start numeric;
begin
  perform btg.assert_curriculum_access(p_activity_id);
  select coalesce(lv.end_seconds,v.duration_seconds),coalesce(lv.start_seconds,0) into v_end,v_start
    from curriculum_lesson_video lv join curriculum_videos v on v.video_id=lv.video_id
    where lv.activity_id=p_activity_id and v.health_status='healthy' and lv.relevance_verified_at is not null;
  if v_end is null or p_position is null or p_position<'0'::numeric or p_position='NaN'::numeric or p_position<v_start or p_position>v_end then
    raise exception 'verified video and valid position required' using errcode='23514';
  end if;
  insert into curriculum_playback_progress(profile_id,activity_id,last_position) values(auth.uid(),p_activity_id,p_position)
    on conflict(profile_id,activity_id) do update set last_position=p_position,last_receipt_at=clock_timestamp();
end $$;

create function public.record_curriculum_playback(p_activity_id uuid,p_request_id uuid,p_from numeric,p_to numeric) returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_progress curriculum_playback_progress; v_end numeric; v_start numeric; v_event btg.curriculum_playback_events;
begin
  perform btg.assert_curriculum_access(p_activity_id);
  select * into v_progress from curriculum_playback_progress where profile_id=auth.uid() and activity_id=p_activity_id for update;
  if not found then raise exception 'begin playback first' using errcode='23514'; end if;
  select * into v_event from btg.curriculum_playback_events where profile_id=auth.uid() and activity_id=p_activity_id and request_id=p_request_id;
  if found then
    if v_event.from_seconds is distinct from p_from or v_event.to_seconds is distinct from p_to then raise exception 'playback event identity conflict' using errcode='23514'; end if;
    return;
  end if;
  select coalesce(lv.end_seconds,v.duration_seconds),coalesce(lv.start_seconds,0) into v_end,v_start from curriculum_lesson_video lv
    join curriculum_videos v on v.video_id=lv.video_id where lv.activity_id=p_activity_id and v.health_status='healthy' and lv.relevance_verified_at is not null;
  if p_request_id is null or p_from is null or p_to is null or p_from='NaN'::numeric or p_to='NaN'::numeric
    or v_end is null or p_from<v_start or p_to>v_end or p_to-p_from<1 or p_to-p_from>15
    or abs(p_from-v_progress.last_position)>2 or p_to-p_from>extract(epoch from clock_timestamp()-v_progress.last_receipt_at)+0.1 then
    raise exception 'invalid or implausible playback interval' using errcode='23514';
  end if;
  insert into btg.curriculum_playback_events values(auth.uid(),p_activity_id,p_request_id,p_from,p_to);
  update curriculum_playback_progress set watched=watched+nummultirange(numrange(p_from,p_to,'[)')),
    last_position=p_to,last_receipt_at=clock_timestamp() where profile_id=auth.uid() and activity_id=p_activity_id;
end $$;

create or replace function btg.guard_curriculum_completion() returns trigger
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_lesson curriculum_lessons; v_required boolean; v_threshold numeric; v_duration numeric; v_watched numeric;
begin
  select * into v_lesson from curriculum_lessons where activity_id=new.activity_id;
  if not found then return new; end if;
  if new.profile_id is distinct from auth.uid() then raise exception 'own lesson completion required' using errcode='42501'; end if;
  if exists(select 1 from learner_activity_completions where profile_id=new.profile_id and activity_id=new.activity_id) then return new; end if;
  perform btg.assert_curriculum_access(new.activity_id);
  select id into new.curriculum_attempt_id from curriculum_attempts where profile_id=auth.uid() and activity_id=new.activity_id
    and status='evaluated' and passed=true and btrim(practice_output)=coalesce(new.output,'') order by attempt_number desc limit 1;
  if not found then
    raise exception 'accepted practice and passed checkpoint required' using errcode='23514';
  end if;
  if v_lesson.contract#>>'{practice,practice_type}'='project' then
    raise exception 'project lesson requires the governed project evidence bridge' using errcode='23514';
  end if;
  select lv.required,lv.threshold,case when v.health_status='healthy' and lv.relevance_verified_at is not null
    then coalesce(lv.end_seconds,v.duration_seconds)-coalesce(lv.start_seconds,0) else null end into v_required,v_threshold,v_duration
    from curriculum_lesson_video lv left join curriculum_videos v on v.video_id=lv.video_id where lv.activity_id=new.activity_id;
  if not found then raise exception 'video requirement missing' using errcode='23514'; end if;
  if v_required then
    select coalesce(sum(upper(r)-lower(r)),0) into v_watched from curriculum_playback_progress p,
      lateral unnest(p.watched) r where p.profile_id=auth.uid() and p.activity_id=new.activity_id;
    if v_duration is null or v_duration<=0 or v_watched/v_duration<v_threshold then
      raise exception 'verified video threshold not met' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'public.start_curriculum_attempt(uuid)','public.save_curriculum_attempt(uuid,text,text,boolean)',
    'public.claim_curriculum_attempt(uuid)','public.curriculum_review_rubric(uuid)',
    'public.evaluate_curriculum_attempt(uuid,jsonb,text)','public.acknowledge_curriculum_remediation(uuid)',
    'public.begin_curriculum_playback(uuid,numeric)','public.record_curriculum_playback(uuid,uuid,numeric,numeric)'
  ] loop execute format('revoke all on function %s from public,anon',fn);
    execute format('grant execute on function %s to authenticated,service_role',fn); end loop;
end $$;
