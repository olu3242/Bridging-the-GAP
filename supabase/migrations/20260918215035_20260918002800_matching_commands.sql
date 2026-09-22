-- E16 matching + E15 application commands.
-- The score is arithmetic over verified requirements: no opaque ranking, and
-- the factors behind it are persisted with the match.

create or replace function btg.compute_opportunity_matches(p_profile_id uuid)
returns int language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_opportunity record; v_matched jsonb; v_missing jsonb; v_score smallint;
        v_required int; v_required_met int; v_desirable int; v_desirable_met int;
        v_credentials int; v_evidence int; v_count int := 0;
begin
  select count(*) into v_credentials from public.credentials
  where profile_id = p_profile_id and status = 'issued';
  select count(*) into v_evidence from public.evidence
  where profile_id = p_profile_id and status = 'accepted';

  for v_opportunity in select * from public.opportunities where status = 'open' loop
    -- Matched: requirements met by a live verified skill at or above the level.
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'competency', c.slug, 'name', c.name, 'required_level', r.min_level,
        'verified_level', vs.level, 'is_required', r.is_required,
        'evidence_id', vs.evidence_id) order by c.name)
        filter (where vs.id is not null), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object(
        'competency', c.slug, 'name', c.name, 'required_level', r.min_level,
        'verified_level', coalesce(vs.level, lc.level, 0), 'is_required', r.is_required,
        'reason', case
          when vs.id is null and lc.competency_id is null then 'not measured yet'
          when vs.id is null then 'measured but not verified from evidence'
          else 'verified below the level required' end) order by c.name)
        filter (where vs.id is null), '[]'::jsonb),
      count(*) filter (where r.is_required),
      count(*) filter (where r.is_required and vs.id is not null),
      count(*) filter (where not r.is_required),
      count(*) filter (where not r.is_required and vs.id is not null)
    into v_matched, v_missing, v_required, v_required_met, v_desirable, v_desirable_met
    from public.opportunity_requirements r
    join public.competencies c on c.id = r.competency_id
    left join public.verified_skills vs
      on vs.competency_id = r.competency_id and vs.profile_id = p_profile_id
         and vs.revoked_at is null and vs.superseded_by is null and vs.level >= r.min_level
    left join (
      select competency_id, level from public.learner_competencies where profile_id = p_profile_id
    ) lc on lc.competency_id = r.competency_id
    where r.opportunity_id = v_opportunity.id;

    if coalesce(v_required, 0) = 0 and coalesce(v_desirable, 0) = 0 then
      continue; -- an opening with no stated requirements cannot be matched honestly
    end if;

    -- Required requirements carry 80 of the score, desirable the remaining 20.
    v_score := least(100, (
      case when v_required > 0 then (v_required_met::numeric / v_required) * 80 else 80 end
      + case when v_desirable > 0 then (v_desirable_met::numeric / v_desirable) * 20 else 20 end
    )::smallint);

    insert into public.opportunity_matches (
      opportunity_id, profile_id, score, matched, missing, evidence_count, credential_count, computed_at
    ) values (
      v_opportunity.id, p_profile_id, v_score, v_matched, v_missing,
      least(v_evidence, 32767), least(v_credentials, 32767), now()
    )
    on conflict (opportunity_id, profile_id) do update set
      score = excluded.score, matched = excluded.matched, missing = excluded.missing,
      evidence_count = excluded.evidence_count, credential_count = excluded.credential_count,
      computed_at = excluded.computed_at;

    v_count := v_count + 1;

    -- Notify only on a strong, newly-qualifying match, once per opportunity.
    if v_required > 0 and v_required_met = v_required then
      perform btg.notify(
        p_profile_id, 'opportunity.matched',
        format('You now qualify for %s', v_opportunity.title),
        'opportunity.matched:' || v_opportunity.id::text,
        'Every requirement is met by a verified skill.', '/opportunities');
    end if;
  end loop;

  return v_count;
end;
$$;

/* Learner-triggered refresh. Reads only their own state. */
create or replace function public.refresh_my_matches()
returns int language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid(); v_count int;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_count := btg.compute_opportunity_matches(v_actor);
  perform public.record_audit_event(
    'matching.matches.computed', 'profile', v_actor::text, null, null,
    null, jsonb_build_object('opportunities_scored', v_count),
    'info'::public.btg_audit_severity, null, 'matching');
  return v_count;
end;
$$;

-- Verification changes what a learner qualifies for, so matches recompute
-- when a skill is verified rather than waiting for the learner to ask.
create or replace function btg.on_verified_skill_recompute_matches()
returns trigger language plpgsql security definer set search_path = public, btg, pg_temp as $$
begin
  perform btg.compute_opportunity_matches(new.profile_id);
  return null;
end;
$$;

drop trigger if exists verified_skills_recompute_matches on public.verified_skills;
create trigger verified_skills_recompute_matches
  after insert on public.verified_skills
  for each row execute function btg.on_verified_skill_recompute_matches();

-- ---------------------------------------------------------------- applying ---
-- Applying shares only the verified skills the learner names, and snapshots
-- the match so a later recompute cannot rewrite what the employer saw.
create or replace function public.apply_to_opportunity(
  p_opportunity_id uuid,
  p_note text default null,
  p_shared_skill_ids uuid[] default '{}'
)
returns public.applications
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_opportunity public.opportunities;
  v_match public.opportunity_matches;
  v_application public.applications;
  v_foreign int;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  select * into v_opportunity from public.opportunities where id = p_opportunity_id;
  if not found then raise exception 'opportunity not found' using errcode = 'P0002'; end if;
  if v_opportunity.status <> 'open' then
    raise exception 'this opportunity is not open' using errcode = 'check_violation';
  end if;
  if v_opportunity.closes_at is not null and v_opportunity.closes_at < now() then
    raise exception 'this opportunity has closed' using errcode = 'check_violation';
  end if;

  -- A learner may only share their own live verified skills.
  select count(*) into v_foreign
  from unnest(coalesce(p_shared_skill_ids, '{}')) as sid
  where not exists (
    select 1 from public.verified_skills vs
    where vs.id = sid and vs.profile_id = v_actor and vs.revoked_at is null
  );
  if v_foreign > 0 then
    raise exception 'you can only share your own verified skills' using errcode = '42501';
  end if;

  select * into v_match from public.opportunity_matches
  where opportunity_id = p_opportunity_id and profile_id = v_actor;

  insert into public.applications (
    opportunity_id, profile_id, status, match_snapshot, shared_verified_skill_ids, note
  ) values (
    p_opportunity_id, v_actor, 'submitted',
    coalesce(
      jsonb_build_object('score', v_match.score, 'matched', v_match.matched,
                         'missing', v_match.missing, 'computed_at', v_match.computed_at),
      jsonb_build_object('score', null, 'note', 'no match was computed at apply time')),
    coalesce(p_shared_skill_ids, '{}'),
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning * into v_application;

  perform public.record_audit_event(
    'opportunity.application.submitted', 'application', v_application.id::text,
    v_opportunity.organization_id, null, null,
    jsonb_build_object('opportunity', v_opportunity.slug, 'score', v_match.score,
                       'shared_skills', array_length(coalesce(p_shared_skill_ids, '{}'), 1)),
    'notice'::public.btg_audit_severity, null, 'opportunities');

  return v_application;
end;
$$;

create or replace function public.withdraw_application(p_application_id uuid)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid(); v_app public.applications;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if v_actor is null or not found or v_app.profile_id <> v_actor then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  update public.applications set status = 'withdrawn', withdrawn_at = now()
  where id = p_application_id;
  perform public.record_audit_event(
    'opportunity.application.withdrawn', 'application', p_application_id::text, null, null,
    jsonb_build_object('status', v_app.status), jsonb_build_object('status', 'withdrawn'),
    'info'::public.btg_audit_severity, null, 'opportunities');
end;
$$;

/* What an employer may see of an applicant: only the skills that were shared,
   with their full verification chain. Nothing else about the learner. */
create or replace view public.application_evidence_view
with (security_invoker = true) as
select a.id as application_id, a.opportunity_id, a.status as application_status,
       a.submitted_at, a.note, a.match_snapshot,
       vs.id as verified_skill_id, vs.level, vs.verified_at,
       c.name as competency_name, c.slug as competency_slug,
       e.summary as evidence_summary, e.artifact_url, e.ai_assistance_declared,
       r.rationale as reviewer_rationale,
       p.display_name as applicant_name
from public.applications a
join public.profiles p on p.id = a.profile_id
left join public.verified_skills vs
  on vs.id = any(a.shared_verified_skill_ids) and vs.revoked_at is null
left join public.competencies c on c.id = vs.competency_id
left join public.evidence e on e.id = vs.evidence_id
left join public.review_assignments r on r.id = vs.review_id;

grant select on public.application_evidence_view to authenticated, service_role;

-- An employer needs the applicant's name; that is the consented disclosure of
-- applying, and it is limited to learners who applied to their own opening.
drop policy if exists profiles_select_applicant on public.profiles;
create policy profiles_select_applicant on public.profiles for select to authenticated
using (
  exists (
    select 1 from public.applications a
    join public.opportunities o on o.id = a.opportunity_id
    where a.profile_id = public.profiles.id
      and a.status <> 'withdrawn'
      and btg.is_org_admin(o.organization_id)
  )
);

-- The shared verified skills of an applicant, for that employer only.
drop policy if exists verified_skills_select_shared on public.verified_skills;
create policy verified_skills_select_shared on public.verified_skills for select to authenticated
using (
  exists (
    select 1 from public.applications a
    join public.opportunities o on o.id = a.opportunity_id
    where verified_skills.id = any(a.shared_verified_skill_ids)
      and a.status <> 'withdrawn'
      and btg.is_org_admin(o.organization_id)
  )
);

drop policy if exists evidence_select_shared on public.evidence;
create policy evidence_select_shared on public.evidence for select to authenticated
using (
  exists (
    select 1 from public.verified_skills vs
    join public.applications a on vs.id = any(a.shared_verified_skill_ids)
    join public.opportunities o on o.id = a.opportunity_id
    where vs.evidence_id = public.evidence.id
      and a.status <> 'withdrawn'
      and btg.is_org_admin(o.organization_id)
  )
);

do $$ declare fn text;
begin
  foreach fn in array array[
    'public.refresh_my_matches()',
    'public.apply_to_opportunity(uuid, text, uuid[])',
    'public.withdraw_application(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
