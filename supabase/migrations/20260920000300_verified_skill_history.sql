-- Supersession references a new skill claim, never an evidence ID.
-- Defer this self-reference until the replacement is inserted in the same transaction.
alter table public.verified_skills alter constraint verified_skills_superseded_by_fkey deferrable initially deferred;

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
  v_replacement_id uuid := gen_random_uuid();
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
      update public.verified_skills set superseded_by = v_replacement_id
      where profile_id = v_evidence.profile_id and competency_id = v_evidence.competency_id
        and revoked_at is null and superseded_by is null;
      insert into public.verified_skills (
        id, profile_id, competency_id, level, evidence_id, rubric_id, review_id, reviewer_profile_id
      ) values (
        v_replacement_id, v_evidence.profile_id, v_evidence.competency_id, coalesce(v_level, 3),
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
