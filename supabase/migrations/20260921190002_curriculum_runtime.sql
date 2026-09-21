-- Versioned metadata extends the existing learning entities. Enrollment and
-- completion remain learner_module_progress / learner_activity_completions.
create table btg.curriculum_manifests (
  version integer primary key check (version > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null default now()
);
revoke all on btg.curriculum_manifests from public, anon, authenticated;
grant select, insert on btg.curriculum_manifests to service_role;

alter table public.learning_activities add constraint learning_activity_module_identity unique(id,module_id);
create table public.curriculum_lessons (
  activity_id uuid primary key,
  module_id uuid not null,
  lesson_code text not null check (lesson_code ~ '^[A-Z]{2}[0-9]{2}$'),
  version integer not null references btg.curriculum_manifests(version),
  domain_code text not null check (domain_code ~ '^D[0-9]{2}$'),
  course_code text not null,
  status text not null default 'draft' check (status in ('draft','published','retired')),
  contract jsonb not null,
  published_at timestamptz,
  unique(lesson_code,version),
  foreign key(activity_id,module_id) references public.learning_activities(id,module_id) on delete restrict,
  check (contract->>'lesson_id'=lesson_code and (contract->>'version')::integer=version),
  check (contract->>'activity_id'=activity_id::text and contract->>'domain'=domain_code and contract->>'course'=course_code),
  check (contract ?& array['learning_objective','instructional_content','practice','checkpoint','competency_ids','progression','prerequisites','evidence_required','video']),
  check (length(btrim(contract#>>'{learning_objective,text}')) > 20),
  check (jsonb_array_length(contract->'instructional_content') >= 3),
  check (jsonb_array_length(contract->'competency_ids') > 0),
  check (jsonb_array_length(contract#>'{checkpoint,questions}') >= 2),
  check (contract#>>'{practice,practice_id}' is not null),
  check (contract#>'{progression,completion_rule,all}' @> '["practice_accepted","checkpoint_passed"]'::jsonb),
  check ((status='draft' and published_at is null) or (status<>'draft' and published_at is not null))
);
create index curriculum_lesson_catalog_idx on public.curriculum_lessons(domain_code,lesson_code,version);

create table btg.curriculum_assessment_keys (
  activity_id uuid primary key references public.curriculum_lessons(activity_id) on delete restrict,
  definition jsonb not null check (jsonb_array_length(definition->'answers') >= 2)
);
revoke all on btg.curriculum_assessment_keys from public, anon, authenticated;
grant select, insert on btg.curriculum_assessment_keys to service_role;

create table public.curriculum_videos (
  video_id text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  provider text not null default 'youtube' check (provider='youtube'),
  source_url text not null,
  embed_url text not null,
  candidate_title text not null,
  duration_seconds integer check (duration_seconds>0),
  health_status text not null default 'needs_review' check (health_status in ('needs_review','healthy','unavailable')),
  verified_at timestamptz,
  verification jsonb,
  transcript text,
  captions jsonb,
  check (source_url='https://www.youtube.com/watch?v='||video_id),
  check (embed_url='https://www.youtube.com/embed/'||video_id),
  check (health_status<>'healthy' or (verified_at is not null and duration_seconds is not null
    and verification is not null and verification @> '{"exists":true,"accessible":true,"embeddable":true,"renders":true,"accessible_equivalent":true}'::jsonb))
);

create table public.curriculum_lesson_video (
  activity_id uuid primary key references public.curriculum_lessons(activity_id) on delete restrict,
  video_id text references public.curriculum_videos(video_id),
  required boolean not null,
  threshold numeric not null default 0.85 check (threshold>0 and threshold<=1),
  start_seconds integer check (start_seconds>=0),
  end_seconds integer,
  relevance_verified_at timestamptz,
  check (end_seconds is null or end_seconds>coalesce(start_seconds,0)),
  check (video_id is not null or (start_seconds is null and end_seconds is null and relevance_verified_at is null))
);

alter table public.curriculum_lessons enable row level security;
alter table public.curriculum_videos enable row level security;
alter table public.curriculum_lesson_video enable row level security;
create policy curriculum_lessons_read on public.curriculum_lessons for select to authenticated
using (status='published' or btg.is_operator() or (status='retired' and exists (
  select 1 from public.learner_module_progress p where p.module_id=curriculum_lessons.module_id and p.profile_id=auth.uid()
)));
create policy curriculum_lesson_video_read on public.curriculum_lesson_video for select to authenticated
using (exists (select 1 from public.curriculum_lessons l where l.activity_id=curriculum_lesson_video.activity_id));
create policy curriculum_videos_read on public.curriculum_videos for select to authenticated
using (btg.is_operator() or exists(select 1 from public.curriculum_lesson_video lv where lv.video_id=curriculum_videos.video_id));
grant select on public.curriculum_lessons, public.curriculum_videos, public.curriculum_lesson_video to authenticated;
grant all on public.curriculum_lessons, public.curriculum_videos, public.curriculum_lesson_video to service_role;

-- Content is immutable once referenced by a published version. Write grants
-- are restricted independently; operators cannot directly change publication.
create function btg.guard_curriculum_contract() returns trigger
language plpgsql set search_path=public,btg,pg_temp as $$
begin
  if tg_op='DELETE' or (old.status<>'draft' and (new.contract<>old.contract or new.activity_id<>old.activity_id
      or new.module_id<>old.module_id or new.version<>old.version or new.lesson_code<>old.lesson_code)) then
    raise exception 'curriculum history is immutable; create a new version' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function btg.guard_curriculum_contract() from public,anon,authenticated;
create trigger curriculum_contract_history before update or delete on public.curriculum_lessons
for each row execute function btg.guard_curriculum_contract();

create function btg.guard_curriculum_activity() returns trigger
language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
  if exists(select 1 from curriculum_lessons where activity_id=old.id and status<>'draft') then
    raise exception 'published curriculum content is immutable' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function btg.guard_curriculum_activity() from public,anon,authenticated;
create trigger curriculum_activity_history before update or delete on public.learning_activities
for each row execute function btg.guard_curriculum_activity();

create function btg.guard_curriculum_module_publication() returns trigger
language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
  if new.status='published' and exists(select 1 from curriculum_lessons where module_id=new.id and status<>'published') then
    raise exception 'publish and verify every required curriculum lesson first' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function btg.guard_curriculum_module_publication() from public,anon,authenticated;
create trigger curriculum_module_publication before update of status on public.learning_modules
for each row execute function btg.guard_curriculum_module_publication();

-- Fail closed at the canonical write boundary until verified runtime evidence
-- is present. The next migration extends this guard with persisted gates.
create function btg.guard_curriculum_completion() returns trigger
language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
  if exists(select 1 from curriculum_lessons where activity_id=new.activity_id) then
    raise exception 'curriculum completion requires verified playback, practice and assessment evidence' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function btg.guard_curriculum_completion() from public,anon,authenticated;
create trigger curriculum_completion_gates before insert on public.learner_activity_completions
for each row execute function btg.guard_curriculum_completion();

create function public.publish_curriculum_lesson(p_activity_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_lesson public.curriculum_lessons; v_mapping public.curriculum_lesson_video; v_asset public.curriculum_videos;
begin
  if auth.uid() is null or not btg.is_operator() then raise exception 'operator required' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'publication reason required' using errcode='23514'; end if;
  select * into strict v_lesson from curriculum_lessons where activity_id=p_activity_id for update;
  if v_lesson.status='published' then return; end if;
  if v_lesson.status<>'draft' then raise exception 'create a new version' using errcode='23514'; end if;
  if not exists(select 1 from btg.curriculum_assessment_keys where activity_id=p_activity_id) then
    raise exception 'protected assessment definition missing' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements_text(v_lesson.contract->'prerequisites') p(code)
    where not exists(select 1 from curriculum_lessons l where l.lesson_code=p.code and l.version=v_lesson.version and l.status='published')) then
    raise exception 'prerequisite curriculum is not published' using errcode='23514';
  end if;
  select * into v_mapping from curriculum_lesson_video where activity_id=p_activity_id;
  if not found then raise exception 'video requirement mapping missing' using errcode='23514'; end if;
  if v_mapping.required then
    select * into v_asset from curriculum_videos where video_id=v_mapping.video_id;
    if not found or v_asset.health_status<>'healthy' or v_mapping.relevance_verified_at is null
      or coalesce(v_mapping.end_seconds,v_asset.duration_seconds)<=coalesce(v_mapping.start_seconds,0)
      or coalesce(v_mapping.end_seconds,v_asset.duration_seconds)>v_asset.duration_seconds then
      raise exception 'video_pending: required source, playback, embedding and relevance must be verified' using errcode='23514';
    end if;
  end if;
  update curriculum_lessons set status='published',published_at=clock_timestamp() where activity_id=p_activity_id;
  perform public.record_audit_event('curriculum.lesson.published','learning_activity',p_activity_id::text,null,null,
    jsonb_build_object('status','draft'),jsonb_build_object('status','published','version',v_lesson.version,'reason',p_reason),
    'notice'::public.btg_audit_severity,null,'curriculum');
end $$;
revoke all on function public.publish_curriculum_lesson(uuid,text) from public,anon;
grant execute on function public.publish_curriculum_lesson(uuid,text) to authenticated,service_role;

create function public.search_curriculum(p_query text default '',p_domain text default null,p_page integer default 1)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with visible as (
  select l.* from curriculum_lessons l
  where (p_domain is null or l.domain_code=p_domain)
    and position(lower(regexp_replace(btrim(left(coalesce(p_query,''),200)),'[[:space:]]+',' ','g'))
      in lower(concat_ws(' ',l.lesson_code,l.domain_code,l.contract->>'title',l.contract#>>'{learning_objective,text}'))) > 0
 ), page as (select activity_id,lesson_code,domain_code,version,status,contract->>'title' as title,
     contract#>>'{learning_objective,text}' as objective from visible order by domain_code,lesson_code,version desc
     limit 20 offset (least(greatest(coalesce(p_page,1),1),10000)-1)*20)
 select jsonb_build_object('total',(select count(*) from visible),'lessons',coalesce((select jsonb_agg(page) from page),'[]'::jsonb),
   'domains',(select count(distinct domain_code) from curriculum_lessons),
   'catalog_total',(select count(*) from curriculum_lessons),
   'published',(select count(*) from curriculum_lessons where status='published'));
$$;
revoke all on function public.search_curriculum(text,text,integer) from public,anon;
grant execute on function public.search_curriculum(text,text,integer) to authenticated,service_role;
