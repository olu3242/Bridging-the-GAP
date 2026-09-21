-- E8/E9/E10/E11/E12 commands. Every transition that matters is here, so no
-- route can complete a project, accept evidence, verify a skill or issue a
-- credential by writing a row.

-- ------------------------------------------------------------------ projects ---
create or replace function public.assign_project(p_brief_slug text, p_step_id uuid default null)
returns public.projects
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_brief public.project_briefs;
  v_project public.projects;
  v_step public.pathway_steps;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  select * into v_brief from public.project_briefs
  where slug = p_brief_slug and status = 'published';
  if not found then raise exception 'brief not found' using errcode = 'P0002'; end if;

  if p_step_id is not null then
    select s.* into v_step from public.pathway_steps s
    join public.pathways p on p.id = s.pathway_id
    where s.id = p_step_id and p.profile_id = v_actor and p.status = 'active';
    if not found then raise exception 'step not found' using errcode = 'P0002'; end if;
    if v_step.status = 'locked' then
      raise exception 'this step is still locked' using errcode = 'check_violation';
    end if;
    if v_step.competency_id <> v_brief.competency_id then
      raise exception 'this brief does not build the competency that step targets'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.projects (brief_id, profile_id, competency_id, pathway_step_id, status)
  values (v_brief.id, v_actor, v_brief.competency_id, p_step_id, 'assigned')
  returning * into v_project;

  perform public.record_audit_event(
    'project.project.assigned', 'project', v_project.id::text, v_brief.organization_id, null,
    null, jsonb_build_object('brief', v_brief.slug, 'step', p_step_id),
    'info'::public.btg_audit_severity, null, 'projects'
  );
  return v_project;
end;
$$;

create or replace function public.start_project(p_project_id uuid)
returns public.projects
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid(); v_project public.projects;
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if v_actor is null or not found or v_project.profile_id <> v_actor then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  update public.projects set status = 'started', started_at = coalesce(started_at, now())
  where id = p_project_id returning * into v_project;
  perform public.record_audit_event(
    'project.project.started', 'project', p_project_id::text, null, null,
    jsonb_build_object('status','assigned'), jsonb_build_object('status','started'),
    'info'::public.btg_audit_severity, null, 'projects');
  return v_project;
end;
$$;

-- ------------------------------------------------------------------ evidence ---
-- Submission creates a new immutable version, supersedes the previous one, and
-- opens exactly one review. Idempotency: a second submission while a review is
-- open is rejected rather than queuing a duplicate.
create or replace function public.submit_evidence(
  p_project_id uuid,
  p_summary text,
  p_artifact_url text default null,
  p_ai_declared boolean default false,
  p_ai_note text default null
)
returns public.evidence
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects;
  v_rubric uuid;
  v_prev public.evidence;
  v_evidence public.evidence;
  v_version smallint;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found or v_project.profile_id <> v_actor then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if v_project.status not in ('assigned','started','revision_required') then
    raise exception 'this project is not open for submission' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_summary, ''))) < 40 then
    raise exception 'describe what you produced in at least 40 characters'
      using errcode = 'check_violation';
  end if;
  if p_ai_declared and coalesce(btrim(p_ai_note), '') = '' then
    raise exception 'say how AI was used when you declare it' using errcode = 'check_violation';
  end if;

  select r.id into v_rubric from public.rubrics r
  where r.brief_id = v_project.brief_id and r.status = 'published'
  order by r.version desc limit 1;
  if v_rubric is null then
    raise exception 'this brief has no published rubric, so it cannot be reviewed'
      using errcode = 'check_violation';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.evidence where project_id = p_project_id;

  select * into v_prev from public.evidence
  where project_id = p_project_id and status in ('submitted','under_review','rejected')
  order by version desc limit 1;

  insert into public.evidence (
    project_id, profile_id, competency_id, rubric_id, version, status,
    summary, artifact_url, ai_assistance_declared, ai_assistance_note
  ) values (
    p_project_id, v_actor, v_project.competency_id, v_rubric, v_version, 'submitted',
    btrim(p_summary), nullif(btrim(coalesce(p_artifact_url, '')), ''),
    coalesce(p_ai_declared, false), nullif(btrim(coalesce(p_ai_note, '')), '')
  )
  returning * into v_evidence;

  -- Never overwrite: the previous version is superseded and stays readable.
  if v_prev.id is not null then
    update public.review_assignments set status = 'revision_required', decided_at = now(),
      reviewer_profile_id = coalesce(reviewer_profile_id, v_actor),
      rationale = coalesce(rationale, 'Superseded by a newer submission from the learner.')
    where evidence_id = v_prev.id and status in ('pending','in_review');
    update public.evidence set status = 'superseded', superseded_at = now(), superseded_by = v_evidence.id
    where id = v_prev.id;
  end if;

  -- A learner may do the work and submit without pressing start, but the
  -- registry keeps `started` on the path so started_at is always meaningful.
  if v_project.status = 'assigned' then
    update public.projects set status = 'started', started_at = coalesce(started_at, now())
    where id = p_project_id;
  end if;

  update public.projects set status = 'submitted', submitted_at = now() where id = p_project_id;
  update public.projects set status = 'under_review' where id = p_project_id;

  insert into public.review_assignments (evidence_id, status) values (v_evidence.id, 'pending');

  perform public.record_audit_event(
    'evidence.evidence.submitted', 'evidence', v_evidence.id::text, null, null,
    case when v_prev.id is null then null else jsonb_build_object('supersedes', v_prev.id) end,
    jsonb_build_object('version', v_version, 'ai_declared', coalesce(p_ai_declared, false)),
    'notice'::public.btg_audit_severity, null, 'evidence'
  );
  return v_evidence;
end;
$$;

-- -------------------------------------------------------------- verification ---
create or replace function public.claim_review(p_review_id uuid)
returns public.review_assignments
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_actor uuid := auth.uid(); v_review public.review_assignments; v_owner uuid;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not (btg.has_platform_persona('reviewer') or btg.is_operator()) then
    raise exception 'reviewing requires the reviewer persona' using errcode = '42501';
  end if;

  select * into v_review from public.review_assignments where id = p_review_id for update;
  if not found then raise exception 'review not found' using errcode = 'P0002'; end if;
  select profile_id into v_owner from public.evidence where id = v_review.evidence_id;
  if v_owner = v_actor then
    raise exception 'you cannot review your own evidence' using errcode = '42501';
  end if;
  if v_review.status <> 'pending' then
    raise exception 'this review is already claimed' using errcode = 'check_violation';
  end if;

  update public.review_assignments
  set status = 'in_review', reviewer_profile_id = v_actor, claimed_at = now()
  where id = p_review_id returning * into v_review;

  update public.evidence set status = 'under_review' where id = v_review.evidence_id;

  perform public.record_audit_event(
    'verification.review.claimed', 'review_assignment', p_review_id::text, null, 'reviewer',
    jsonb_build_object('status','pending'), jsonb_build_object('status','in_review'),
    'info'::public.btg_audit_severity, null, 'verification');
  return v_review;
end;
$$;

/* The decision. Scores are recorded per criterion; approval requires every
   required criterion to score 3 or better, so a reviewer cannot approve work
   the rubric says failed. Approval mints the verified skill. */
create or replace function public.decide_review(
  p_review_id uuid,
  p_decision public.btg_review_status,
  p_rationale text,
  p_scores jsonb default '[]'::jsonb
)
returns public.review_assignments
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_review public.review_assignments;
  v_evidence public.evidence;
  v_score record;
  v_required_failed int;
  v_required_missing int;
  v_level smallint;
  v_skill public.verified_skills;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_decision not in ('approved','rejected','revision_required') then
    raise exception 'unsupported decision' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_rationale, ''))) < 10 then
    raise exception 'a decision needs a rationale' using errcode = 'check_violation';
  end if;

  select * into v_review from public.review_assignments where id = p_review_id for update;
  if not found then raise exception 'review not found' using errcode = 'P0002'; end if;
  if v_review.status <> 'in_review' or v_review.reviewer_profile_id <> v_actor then
    raise exception 'claim this review before deciding it' using errcode = '42501';
  end if;

  select * into v_evidence from public.evidence where id = v_review.evidence_id;
  if v_evidence.profile_id = v_actor then
    raise exception 'you cannot review your own evidence' using errcode = '42501';
  end if;

  -- Record the per-criterion judgement.
  for v_score in
    select (value->>'criterion_id')::uuid as criterion_id,
           (value->>'score')::smallint as score,
           value->>'note' as note
    from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb))
  loop
    insert into public.review_scores (review_id, criterion_id, score, note)
    values (p_review_id, v_score.criterion_id, v_score.score, v_score.note)
    on conflict (review_id, criterion_id) do update set score = excluded.score, note = excluded.note;
  end loop;

  if p_decision = 'approved' then
    select count(*) into v_required_missing
    from public.rubric_criteria c
    where c.rubric_id = v_evidence.rubric_id and c.is_required
      and not exists (select 1 from public.review_scores s
                      where s.review_id = p_review_id and s.criterion_id = c.id);
    if v_required_missing > 0 then
      raise exception 'score every required criterion before approving' using errcode = 'check_violation';
    end if;

    select count(*) into v_required_failed
    from public.review_scores s
    join public.rubric_criteria c on c.id = s.criterion_id
    where s.review_id = p_review_id and c.is_required and s.score < 3;
    if v_required_failed > 0 then
      raise exception 'the rubric does not support approval: % required criteria scored below 3',
        v_required_failed using errcode = 'check_violation';
    end if;
  end if;

  update public.review_assignments
  set status = p_decision, decided_at = now(), rationale = btrim(p_rationale)
  where id = p_review_id returning * into v_review;

  if p_decision = 'approved' then
    update public.evidence set status = 'accepted' where id = v_evidence.id;

    select b.target_level into v_level
    from public.projects pr join public.project_briefs b on b.id = pr.brief_id
    where pr.id = v_evidence.project_id;

    -- Insert the new claim. If a live claim already exists for this
    -- competency the partial unique index blocks it, and the fallback below
    -- supersedes the old one rather than rewriting it.
    insert into public.verified_skills (
      profile_id, competency_id, level, evidence_id, rubric_id, review_id, reviewer_profile_id
    ) values (
      v_evidence.profile_id, v_evidence.competency_id, coalesce(v_level, 3),
      v_evidence.id, v_evidence.rubric_id, p_review_id, v_actor
    )
    on conflict do nothing
    returning * into v_skill;

    if v_skill.id is null then
      -- A live claim already exists: supersede it, then record the new one.
      update public.verified_skills set superseded_by = v_evidence.id
      where profile_id = v_evidence.profile_id and competency_id = v_evidence.competency_id
        and revoked_at is null and superseded_by is null;
      insert into public.verified_skills (
        profile_id, competency_id, level, evidence_id, rubric_id, review_id, reviewer_profile_id
      ) values (
        v_evidence.profile_id, v_evidence.competency_id, coalesce(v_level, 3),
        v_evidence.id, v_evidence.rubric_id, p_review_id, v_actor
      ) returning * into v_skill;
    end if;

    -- The measured baseline is updated from reviewed evidence, which outranks
    -- a diagnostic estimate.
    insert into public.learner_competencies (
      profile_id, competency_id, level, confidence, source, measured_at
    ) values (v_evidence.profile_id, v_evidence.competency_id, v_skill.level, 1.00, 'evidence', now())
    on conflict (profile_id, competency_id) do update set
      level = greatest(public.learner_competencies.level, excluded.level),
      confidence = excluded.confidence, source = excluded.source, measured_at = excluded.measured_at;

    update public.projects set status = 'completed', completed_at = now()
    where id = v_evidence.project_id;

    perform public.record_audit_event(
      'verification.skill.verified', 'verified_skill', v_skill.id::text, null, 'reviewer',
      null,
      jsonb_build_object('competency_id', v_evidence.competency_id, 'level', v_skill.level,
                         'evidence_id', v_evidence.id, 'review_id', p_review_id),
      'critical'::public.btg_audit_severity, null, 'verification');

    perform btg.notify(
      v_evidence.profile_id, 'skill.verified', 'A skill was verified',
      'skill.verified:' || v_skill.id::text,
      'Your submitted evidence was reviewed and accepted.', '/portfolio');

    perform btg.issue_eligible_credentials(v_evidence.profile_id);
    perform btg.maybe_complete_pathway_step(
      (select pathway_step_id from public.projects where id = v_evidence.project_id));

  elsif p_decision = 'rejected' then
    update public.evidence set status = 'rejected' where id = v_evidence.id;
    update public.projects set status = 'revision_required' where id = v_evidence.project_id;
    perform public.record_audit_event(
      'verification.review.rejected', 'evidence', v_evidence.id::text, null, 'reviewer',
      null, jsonb_build_object('rationale', btrim(p_rationale)),
      'notice'::public.btg_audit_severity, null, 'verification');
    perform btg.notify(
      v_evidence.profile_id, 'evidence.rejected', 'Your submission needs more work',
      'evidence.rejected:' || v_evidence.id::text, btrim(p_rationale), '/projects');
  else
    update public.evidence set status = 'rejected' where id = v_evidence.id;
    update public.projects set status = 'revision_required' where id = v_evidence.project_id;
    perform public.record_audit_event(
      'verification.review.revision_required', 'evidence', v_evidence.id::text, null, 'reviewer',
      null, jsonb_build_object('rationale', btrim(p_rationale)),
      'notice'::public.btg_audit_severity, null, 'verification');
    perform btg.notify(
      v_evidence.profile_id, 'evidence.revision', 'A reviewer asked for a revision',
      'evidence.revision:' || v_evidence.id::text, btrim(p_rationale), '/projects');
  end if;

  return v_review;
end;
$$;

-- ------------------------------------------------------------- credentials ---
create or replace function btg.issue_eligible_credentials(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_def record; v_skill_ids uuid[]; v_credential public.credentials; v_met int; v_needed int;
begin
  for v_def in select * from public.credential_definitions where status = 'published' loop
    v_needed := array_length(v_def.required_competency_slugs, 1);

    select array_agg(vs.id), count(*) into v_skill_ids, v_met
    from public.verified_skills vs
    join public.competencies c on c.id = vs.competency_id
    where vs.profile_id = p_profile_id and vs.revoked_at is null and vs.superseded_by is null
      and c.slug = any(v_def.required_competency_slugs) and vs.level >= v_def.min_level;

    if coalesce(v_met, 0) < v_needed then
      continue; -- not eligible; nothing is issued or implied
    end if;
    if exists (select 1 from public.credentials
               where profile_id = p_profile_id and slug = v_def.slug and status = 'issued') then
      continue; -- idempotent
    end if;

    insert into public.credentials (profile_id, slug, title, criteria, issuance_basis)
    values (
      p_profile_id, v_def.slug, v_def.title,
      jsonb_build_object('required_competencies', v_def.required_competency_slugs,
                         'min_level', v_def.min_level),
      jsonb_build_object('verified_skill_ids', to_jsonb(v_skill_ids), 'issued_by', 'automatic_on_eligibility')
    )
    returning * into v_credential;

    insert into public.credential_skills (credential_id, verified_skill_id)
    select v_credential.id, unnest(v_skill_ids);

    perform public.record_audit_event(
      'credential.credential.issued', 'credential', v_credential.id::text, null, null,
      null, jsonb_build_object('slug', v_def.slug, 'skills', to_jsonb(v_skill_ids)),
      'critical'::public.btg_audit_severity, null, 'credentials');

    perform btg.notify(
      p_profile_id, 'credential.issued', format('You earned %s', v_def.title),
      'credential.issued:' || v_credential.id::text,
      'Issued against your verified skills.', '/portfolio');
  end loop;
end;
$$;

create or replace function public.revoke_credential(p_credential_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
begin
  if not btg.is_operator() then
    raise exception 'only an operator may revoke a credential' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'revocation needs a reason' using errcode = 'check_violation';
  end if;
  update public.credentials
  set status = 'revoked', revoked_at = now(), revocation_reason = btrim(p_reason)
  where id = p_credential_id and status = 'issued';
  if not found then raise exception 'credential not found' using errcode = 'P0002'; end if;

  perform public.record_audit_event(
    'credential.credential.revoked', 'credential', p_credential_id::text, null, 'operator',
    jsonb_build_object('status','issued'), jsonb_build_object('status','revoked','reason',btrim(p_reason)),
    'critical'::public.btg_audit_severity, null, 'credentials');
end;
$$;

-- A pathway step now needs its learning done AND, where the competency asks
-- for evidence, a live verified skill. This replaces the learning-only rule.
create or replace function btg.maybe_complete_pathway_step(p_step_id uuid)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_step public.pathway_steps; v_open int; v_requires_evidence boolean; v_verified boolean;
begin
  if p_step_id is null then return; end if;

  select * into v_step from public.pathway_steps where id = p_step_id;
  if not found then return; end if;

  select count(*) into v_open from public.learner_module_progress
  where pathway_step_id = p_step_id and status <> 'completed';
  if v_open > 0 then return; end if;

  select c.evidence_requirement is not null into v_requires_evidence
  from public.competencies c where c.id = v_step.competency_id;

  if coalesce(v_requires_evidence, false) then
    select exists (
      select 1 from public.verified_skills vs
      join public.pathways p on p.id = v_step.pathway_id
      where vs.profile_id = p.profile_id and vs.competency_id = v_step.competency_id
        and vs.revoked_at is null and vs.superseded_by is null
    ) into v_verified;
    if not v_verified then return; end if;
  end if;

  perform btg.complete_pathway_step(p_step_id,
    case when coalesce(v_requires_evidence, false) then 'learning_and_verified_evidence'
         else 'learning_complete' end);
end;
$$;

create or replace view public.portfolio_view
with (security_invoker = true) as
select vs.id as verified_skill_id, vs.profile_id, vs.level, vs.verified_at, vs.revoked_at,
       c.slug as competency_slug, c.name as competency_name, d.name as domain_name,
       e.id as evidence_id, e.version as evidence_version, e.summary as evidence_summary,
       e.artifact_url, e.ai_assistance_declared,
       r.id as review_id, r.rationale as reviewer_rationale, r.decided_at,
       reviewer.display_name as reviewer_name,
       pr.id as project_id, b.title as project_title, b.slug as project_slug
from public.verified_skills vs
join public.competencies c on c.id = vs.competency_id
join public.competency_domains d on d.id = c.domain_id
join public.evidence e on e.id = vs.evidence_id
join public.review_assignments r on r.id = vs.review_id
join public.profiles reviewer on reviewer.id = vs.reviewer_profile_id
join public.projects pr on pr.id = e.project_id
join public.project_briefs b on b.id = pr.brief_id;

comment on view public.portfolio_view is
  'E11: every verified skill with the full chain that produced it.';

grant select on public.portfolio_view to authenticated, service_role;

do $$ declare fn text;
begin
  foreach fn in array array[
    'public.assign_project(text, uuid)',
    'public.start_project(uuid)',
    'public.submit_evidence(uuid, text, text, boolean, text)',
    'public.claim_review(uuid)',
    'public.decide_review(uuid, public.btg_review_status, text, jsonb)',
    'public.revoke_credential(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
