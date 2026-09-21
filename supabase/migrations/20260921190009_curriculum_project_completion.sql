-- Use governed project evidence in the existing activity completion gate.
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
    if not exists(select 1 from curriculum_project_briefs where activity_id=new.activity_id)
      or exists(select 1 from curriculum_project_briefs b where b.activity_id=new.activity_id and not exists(
        select 1 from projects p join evidence e on e.project_id=p.id
        join verified_skills v on v.evidence_id=e.id and v.competency_id=b.competency_id
        where p.brief_id=b.brief_id and p.profile_id=auth.uid() and p.status='completed'
          and e.status='accepted' and v.profile_id=auth.uid() and v.revoked_at is null
          and v.level>=3
      )) then raise exception 'approved project evidence for every competency required' using errcode='23514'; end if;
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
