-- W02 Batch A — authoritative diagnostic commands.
-- Grading, level estimation and the baseline write all happen inside the
-- database so a client can neither grade itself nor forge a competency level.

-- A learner may read their own responses but NOT the is_correct column: that
-- column is the answer key by another name. Column-level grants, because RLS
-- filters rows, not columns.
revoke select on public.diagnostic_responses from authenticated;
grant select (id, attempt_id, question_id, selected_option_ids, responded_at, elapsed_ms)
  on public.diagnostic_responses to authenticated;

grant all on public.competency_domains, public.competencies, public.competency_levels,
  public.competency_prerequisites, public.diagnostics, public.diagnostic_questions,
  public.diagnostic_answer_keys, public.diagnostic_attempts, public.diagnostic_responses,
  public.learner_competencies to service_role;

-- --------------------------------------------------------------- start/resume ---
create or replace function public.start_diagnostic_attempt(p_slug text default null)
returns public.diagnostic_attempts
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_diag public.diagnostics;
  v_attempt public.diagnostic_attempts;
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  if p_slug is null then
    select * into v_diag from public.diagnostics
    where is_baseline and status = 'published' limit 1;
  else
    select * into v_diag from public.diagnostics
    where slug = p_slug and status = 'published';
  end if;
  if not found then
    raise exception 'no published diagnostic available' using errcode = 'P0002';
  end if;

  -- Resume rather than start a second attempt.
  select * into v_attempt from public.diagnostic_attempts
  where profile_id = v_actor and diagnostic_id = v_diag.id and status = 'in_progress';
  if found then
    return v_attempt;
  end if;

  insert into public.diagnostic_attempts (diagnostic_id, profile_id, question_budget)
  values (v_diag.id, v_actor, v_diag.max_questions)
  returning * into v_attempt;

  perform public.record_audit_event(
    'diagnostic.attempt.started', 'diagnostic_attempt', v_attempt.id::text, null, null,
    null, jsonb_build_object('diagnostic', v_diag.slug, 'budget', v_attempt.question_budget),
    'info'::public.btg_audit_severity, null, 'baseline_diagnostic'
  );

  return v_attempt;
end;
$$;

-- ------------------------------------------------------------ adaptive walk ---
-- Two questions per competency: one at level 2, then level 4 if that was right
-- and level 1 if it was not. Deterministic and explainable — no model involved.
create or replace function public.next_diagnostic_question(p_attempt_id uuid)
returns table (
  question_id uuid,
  competency_id uuid,
  competency_name text,
  domain_name text,
  level smallint,
  kind public.btg_question_kind,
  prompt text,
  options jsonb,
  asked_ordinal smallint,
  total_expected smallint
)
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_attempt public.diagnostic_attempts;
  v_target_level smallint;
  v_competency uuid;
  v_first_correct boolean;
  v_total smallint;
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  select * into v_attempt from public.diagnostic_attempts where id = p_attempt_id;
  if not found or v_attempt.profile_id <> v_actor then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;
  if v_attempt.status <> 'in_progress' then
    return;
  end if;
  if v_attempt.answered_count >= v_attempt.question_budget then
    return;
  end if;

  select count(distinct q.competency_id) * 2 into v_total
  from public.diagnostic_questions q where q.diagnostic_id = v_attempt.diagnostic_id;
  v_total := least(v_total, v_attempt.question_budget);

  -- The competency currently being probed: the first one with fewer than two
  -- answers, in catalogue order.
  select c.id into v_competency
  from public.competencies c
  join public.competency_domains d on d.id = c.domain_id
  where exists (
    select 1 from public.diagnostic_questions q
    where q.diagnostic_id = v_attempt.diagnostic_id and q.competency_id = c.id
  )
  group by c.id, d.sort_order, c.sort_order
  having (
    select count(*) from public.diagnostic_responses r
    join public.diagnostic_questions q on q.id = r.question_id
    where r.attempt_id = p_attempt_id and q.competency_id = c.id
  ) < 2
  order by d.sort_order, c.sort_order
  limit 1;

  if v_competency is null then
    return; -- every competency probed; the attempt is ready to submit
  end if;

  select r.is_correct into v_first_correct
  from public.diagnostic_responses r
  join public.diagnostic_questions q on q.id = r.question_id
  where r.attempt_id = p_attempt_id and q.competency_id = v_competency
  order by r.responded_at
  limit 1;

  v_target_level := case
    when v_first_correct is null then 2::smallint       -- opening probe
    when v_first_correct then 4::smallint               -- step up
    else 1::smallint                                    -- step down
  end;

  return query
  select q.id, q.competency_id, c.name, d.name, q.level, q.kind, q.prompt, q.options,
         (v_attempt.answered_count + 1)::smallint, v_total
  from public.diagnostic_questions q
  join public.competencies c on c.id = q.competency_id
  join public.competency_domains d on d.id = c.domain_id
  where q.diagnostic_id = v_attempt.diagnostic_id
    and q.competency_id = v_competency
    and q.level = v_target_level
    and not exists (
      select 1 from public.diagnostic_responses r
      where r.attempt_id = p_attempt_id and r.question_id = q.id
    )
  order by q.sort_order
  limit 1;
end;
$$;

-- ------------------------------------------------------------------- answer ---
create or replace function public.answer_diagnostic_question(
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected text[],
  p_elapsed_ms integer default null
)
returns void
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_attempt public.diagnostic_attempts;
  v_question public.diagnostic_questions;
  v_key public.diagnostic_answer_keys;
  v_correct boolean;
  v_valid_ids text[];
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  select * into v_attempt from public.diagnostic_attempts where id = p_attempt_id for update;
  if not found or v_attempt.profile_id <> v_actor then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'this attempt is no longer open' using errcode = 'check_violation';
  end if;
  if v_attempt.answered_count >= v_attempt.question_budget then
    raise exception 'question budget exhausted' using errcode = 'check_violation';
  end if;

  select * into v_question from public.diagnostic_questions
  where id = p_question_id and diagnostic_id = v_attempt.diagnostic_id;
  if not found then
    raise exception 'question does not belong to this attempt' using errcode = 'check_violation';
  end if;

  -- Selections must be options that exist on this question.
  select array_agg(value->>'id') into v_valid_ids
  from jsonb_array_elements(v_question.options) as value;
  if not (p_selected <@ v_valid_ids) then
    raise exception 'selection is not an option on this question' using errcode = 'check_violation';
  end if;
  if v_question.kind = 'single_choice' and array_length(p_selected, 1) <> 1 then
    raise exception 'this question takes exactly one answer' using errcode = 'check_violation';
  end if;

  -- Graded here, against a table the learner cannot read.
  select * into v_key from public.diagnostic_answer_keys where question_id = p_question_id;
  if found then
    v_correct := (p_selected <@ v_key.correct_option_ids)
             and (v_key.correct_option_ids <@ p_selected);
  else
    v_correct := null; -- self-report questions carry no key
  end if;

  insert into public.diagnostic_responses (
    attempt_id, question_id, selected_option_ids, is_correct, elapsed_ms
  ) values (p_attempt_id, p_question_id, p_selected, v_correct, p_elapsed_ms);

  update public.diagnostic_attempts
  set answered_count = answered_count + 1
  where id = p_attempt_id;
end;
$$;

-- --------------------------------------------------------- submit and score ---
-- Estimate = the highest level the learner answered correctly, 0 if none.
-- A two-question probe cannot resolve every level, so confidence reflects how
-- many questions stood behind the estimate.
create or replace function public.submit_diagnostic_attempt(p_attempt_id uuid)
returns public.diagnostic_attempts
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_attempt public.diagnostic_attempts;
  v_diag public.diagnostics;
  v_result jsonb;
  v_row record;
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  select * into v_attempt from public.diagnostic_attempts where id = p_attempt_id for update;
  if not found or v_attempt.profile_id <> v_actor then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'this attempt has already been submitted' using errcode = 'check_violation';
  end if;
  if v_attempt.answered_count = 0 then
    raise exception 'answer at least one question before submitting' using errcode = 'check_violation';
  end if;

  select * into v_diag from public.diagnostics where id = v_attempt.diagnostic_id;

  update public.diagnostic_attempts set status = 'submitted', submitted_at = now()
  where id = p_attempt_id;

  -- Per-competency estimate from the graded responses.
  for v_row in
    select q.competency_id,
           coalesce(max(q.level) filter (where r.is_correct), 0)::smallint as est_level,
           count(*)::int as asked,
           count(*) filter (where r.is_correct)::int as correct
    from public.diagnostic_responses r
    join public.diagnostic_questions q on q.id = r.question_id
    where r.attempt_id = p_attempt_id
    group by q.competency_id
  loop
    insert into public.learner_competencies (
      profile_id, competency_id, level, confidence, source, attempt_id, measured_at
    ) values (
      v_actor, v_row.competency_id, v_row.est_level,
      least(0.35 + 0.15 * v_row.asked, 0.95), 'baseline', p_attempt_id, now()
    )
    on conflict (profile_id, competency_id) do update set
      level = excluded.level,
      confidence = excluded.confidence,
      source = excluded.source,
      attempt_id = excluded.attempt_id,
      measured_at = excluded.measured_at;
  end loop;

  select jsonb_build_object(
    'answered', v_attempt.answered_count,
    'competencies', coalesce(jsonb_agg(jsonb_build_object(
      'competency_id', t.competency_id,
      'slug', t.slug,
      'name', t.name,
      'level', t.est_level,
      'target_level', t.target_level,
      'asked', t.asked,
      'correct', t.correct
    ) order by t.name), '[]'::jsonb)
  ) into v_result
  from (
    select q.competency_id, c.slug, c.name, c.target_level,
           coalesce(max(q.level) filter (where r.is_correct), 0) as est_level,
           count(*) as asked, count(*) filter (where r.is_correct) as correct
    from public.diagnostic_responses r
    join public.diagnostic_questions q on q.id = r.question_id
    join public.competencies c on c.id = q.competency_id
    where r.attempt_id = p_attempt_id
    group by q.competency_id, c.slug, c.name, c.target_level
  ) t;

  update public.diagnostic_attempts
  set status = 'scored', scored_at = now(), result = v_result
  where id = p_attempt_id
  returning * into v_attempt;

  if v_diag.is_baseline then
    update public.profiles set baseline_completed_at = coalesce(baseline_completed_at, now())
    where id = v_actor;
  end if;

  perform public.record_audit_event(
    'diagnostic.attempt.scored', 'diagnostic_attempt', p_attempt_id::text, null, null,
    null, v_result, 'notice'::public.btg_audit_severity, null, 'baseline_diagnostic'
  );

  perform public.enqueue_notification(
    v_actor, 'baseline.scored', 'Your baseline is ready',
    'baseline.scored:' || p_attempt_id::text,
    'We measured where you stand. Your gaps are the basis of your pathway.',
    '/baseline/results'
  );

  return v_attempt;
end;
$$;

create or replace function public.abandon_diagnostic_attempt(p_attempt_id uuid)
returns void
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_attempt public.diagnostic_attempts;
begin
  select * into v_attempt from public.diagnostic_attempts where id = p_attempt_id for update;
  if v_actor is null or not found or v_attempt.profile_id <> v_actor then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;

  update public.diagnostic_attempts set status = 'abandoned', abandoned_at = now()
  where id = p_attempt_id;

  perform public.record_audit_event(
    'diagnostic.attempt.abandoned', 'diagnostic_attempt', p_attempt_id::text, null, null,
    null, null, 'info'::public.btg_audit_severity, null, 'baseline_diagnostic'
  );
end;
$$;

-- ------------------------------------------------------------ gap read model ---
-- security_invoker: the underlying RLS decides which learners a caller sees, so
-- the view needs no authorization logic of its own.
create or replace view public.learner_competency_gaps
with (security_invoker = true) as
select
  lc.profile_id,
  c.id as competency_id,
  c.slug,
  c.name,
  c.description,
  d.name as domain_name,
  d.slug as domain_slug,
  lc.level,
  c.target_level,
  greatest(c.target_level - lc.level, 0)::smallint as gap,
  lc.confidence,
  lc.source,
  lc.measured_at,
  cl.label as level_label,
  cl.descriptor as level_descriptor,
  (
    select coalesce(array_agg(pc.name order by pc.name), '{}')
    from public.competency_prerequisites p
    join public.competencies pc on pc.id = p.prerequisite_id
    left join public.learner_competencies plc
      on plc.competency_id = p.prerequisite_id and plc.profile_id = lc.profile_id
    where p.competency_id = c.id and coalesce(plc.level, 0) < p.minimum_level
  ) as unmet_prerequisites
from public.learner_competencies lc
join public.competencies c on c.id = lc.competency_id
join public.competency_domains d on d.id = c.domain_id
left join public.competency_levels cl on cl.competency_id = c.id and cl.level = lc.level;

comment on view public.learner_competency_gaps is
  'E3/E4 read model: measured level vs target, with the prerequisites still unmet.';

grant select on public.learner_competency_gaps to authenticated, service_role;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.start_diagnostic_attempt(text)',
    'public.next_diagnostic_question(uuid)',
    'public.answer_diagnostic_question(uuid, uuid, text[], integer)',
    'public.submit_diagnostic_attempt(uuid)',
    'public.abandon_diagnostic_attempt(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
