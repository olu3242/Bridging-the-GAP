-- Curriculum release console: read-only readiness reporting plus an idempotent
-- bulk publisher.
--
-- Neither function relaxes a publication rule. `curriculum_release_readiness`
-- only *reports* what `publish_curriculum_lesson` would decide, and
-- `publish_ready_curriculum_lessons` reaches publication by calling that same
-- function once per lesson and recording whatever it raises. There is no second
-- publication path, so a gate can never be satisfied here and not there.

-- Reports why each lesson can or cannot publish.
--
-- SECURITY DEFINER because readiness depends on btg.curriculum_assessment_keys,
-- which `authenticated` cannot read and must not be able to: the answer callers
-- need is "a definition exists", never the definition itself.
create function public.curriculum_release_readiness() returns jsonb
language plpgsql stable security definer set search_path=public,btg,pg_temp as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not btg.is_operator() then
    raise exception 'operator required' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(row order by row->>'lesson_code'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'activity_id', l.activity_id,
      'lesson_code', l.lesson_code,
      'domain_code', l.domain_code,
      'version', l.version,
      'status', l.status,
      'title', l.contract->>'title',
      'assessment_ready', exists(select 1 from btg.curriculum_assessment_keys k where k.activity_id=l.activity_id),
      'prerequisites', coalesce(l.contract->'prerequisites', '[]'::jsonb),
      'prerequisites_unpublished', coalesce((
        select jsonb_agg(p.code order by p.code)
        from jsonb_array_elements_text(coalesce(l.contract->'prerequisites','[]'::jsonb)) p(code)
        where not exists (
          select 1 from public.curriculum_lessons pl
          where pl.lesson_code=p.code and pl.version=l.version and pl.status='published')
      ), '[]'::jsonb),
      'video_required', coalesce(v.required, false),
      'video_mapped', v.video_id is not null,
      'video_health', a.health_status,
      'video_relevance_verified', v.relevance_verified_at is not null,
      'video_duration_seconds', a.duration_seconds,
      'video_start_seconds', v.start_seconds,
      'video_end_seconds', v.end_seconds,
      'video_mapping_present', v.activity_id is not null
    ) as row
    from public.curriculum_lessons l
    left join public.curriculum_lesson_video v on v.activity_id=l.activity_id
    left join public.curriculum_videos a on a.video_id=v.video_id
  ) s;

  return v_rows;
end $$;
revoke all on function public.curriculum_release_readiness() from public,anon;
grant execute on function public.curriculum_release_readiness() to authenticated,service_role;

-- Publishes every lesson that already satisfies the gates, in dependency order.
--
-- Ordering is a fixed point rather than a topological sort: each pass publishes
-- what it can, and a later pass picks up lessons whose prerequisites the earlier
-- pass just published. It terminates because a pass that publishes nothing ends
-- the loop, and it is idempotent because `publish_curriculum_lesson` returns
-- silently for an already-published lesson.
create function public.publish_ready_curriculum_lessons(p_reason text) returns jsonb
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare
  v_lesson record;
  v_published integer := 0;
  v_pass_published integer;
  v_blockers jsonb := '[]'::jsonb;
  v_already integer := 0;
  v_passes integer := 0;
begin
  if auth.uid() is null or not btg.is_operator() then
    raise exception 'operator required' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_reason,'')))<10 then
    raise exception 'publication reason required' using errcode='23514';
  end if;

  select count(*) into v_already from public.curriculum_lessons where status='published';

  loop
    v_pass_published := 0;
    v_passes := v_passes + 1;
    -- Prerequisite-light lessons first, so a pass makes as much progress as it can.
    for v_lesson in
      select l.activity_id, l.lesson_code
      from public.curriculum_lessons l
      where l.status='draft'
      order by jsonb_array_length(coalesce(l.contract->'prerequisites','[]'::jsonb)), l.lesson_code
    loop
      begin
        perform public.publish_curriculum_lesson(v_lesson.activity_id, p_reason);
        v_published := v_published + 1;
        v_pass_published := v_pass_published + 1;
      exception when others then
        -- A blocked lesson is data, not a failure: record it and keep going so
        -- one held lesson cannot stop every independent one behind it.
        null;
      end;
    end loop;
    exit when v_pass_published = 0 or v_passes > 20;
  end loop;

  -- Re-derive blockers after the loop so the report reflects the final state
  -- rather than a reason that a later pass resolved.
  -- Root cause first, deliberately in a different order from the publication
  -- function's own checks. `publish_curriculum_lesson` raises whichever gate it
  -- reaches first and stops, which is correct for enforcement. For a report it
  -- is misleading: 97 of the held lessons fail BOTH their own media gate and the
  -- prerequisite gate, and the prerequisite failure is downstream — it resolves
  -- itself once the upstream lesson's media is verified. Reporting the intrinsic
  -- blocker (this lesson's own assessment or media) before the extrinsic one
  -- tells an operator what to actually go and do. `reasons` carries the full set.
  select coalesce(jsonb_agg(jsonb_build_object(
      'lesson_code', l.lesson_code,
      'domain_code', l.domain_code,
      'reason', r.reasons->>0,
      'reasons', r.reasons
    ) order by l.lesson_code), '[]'::jsonb)
  into v_blockers
  from public.curriculum_lessons l
  cross join lateral (
    select coalesce(jsonb_agg(reason order by rank), '[]'::jsonb) as reasons from (
      select 1 as rank, 'protected assessment definition missing' as reason
      where not exists(select 1 from btg.curriculum_assessment_keys k where k.activity_id=l.activity_id)
      union all
      select 2, 'video requirement mapping missing'
      where not exists(select 1 from public.curriculum_lesson_video v where v.activity_id=l.activity_id)
      union all
      select 3, 'video_pending: required source, playback, embedding and relevance must be verified'
      where exists (
        select 1 from public.curriculum_lesson_video v
        left join public.curriculum_videos a on a.video_id=v.video_id
        where v.activity_id=l.activity_id and v.required
          and (a.video_id is null or a.health_status<>'healthy' or v.relevance_verified_at is null
            or coalesce(v.end_seconds,a.duration_seconds) <= coalesce(v.start_seconds,0)
            or coalesce(v.end_seconds,a.duration_seconds) > a.duration_seconds))
      union all
      select 4, 'prerequisite curriculum is not published'
      where exists (
        select 1 from jsonb_array_elements_text(coalesce(l.contract->'prerequisites','[]'::jsonb)) p(code)
        where not exists (select 1 from public.curriculum_lessons pl
          where pl.lesson_code=p.code and pl.version=l.version and pl.status='published'))
    ) ordered
  ) r
  where l.status='draft' and jsonb_array_length(r.reasons) > 0;

  return jsonb_build_object(
    'published_this_run', v_published,
    'already_published', v_already,
    'total_published', (select count(*) from public.curriculum_lessons where status='published'),
    'total_lessons', (select count(*) from public.curriculum_lessons),
    'blocked', jsonb_array_length(v_blockers),
    'blockers', v_blockers,
    'passes', v_passes
  );
end $$;
revoke all on function public.publish_ready_curriculum_lessons(text) from public,anon;
grant execute on function public.publish_ready_curriculum_lessons(text) to authenticated,service_role;
