-- W02 Batch A — spread the correct option across positions.
-- The seed authored every correct answer in the same slot, which a learner
-- could game without knowing anything. Labels are rotated by a deterministic
-- offset derived from the question's identity (competency order + level), so
-- the spread is stable across environments and reproducible in tests.

do $$
declare
  q record;
  v_offset int;
  v_labels text[];
  v_new jsonb;
  v_correct_index int;
  i int;
begin
  for q in
    select dq.id, dq.options, dq.level, c.sort_order as competency_order, d.sort_order as domain_order,
           ak.correct_option_ids
    from public.diagnostic_questions dq
    join public.competencies c on c.id = dq.competency_id
    join public.competency_domains d on d.id = c.domain_id
    join public.diagnostics dg on dg.id = dq.diagnostic_id
    join public.diagnostic_answer_keys ak on ak.question_id = dq.id
    where dg.slug = 'baseline-ai-literacy'
      and array_length(ak.correct_option_ids, 1) = 1
    order by dq.id
  loop
    -- Where the correct label currently sits.
    select ord - 1 into v_correct_index
    from jsonb_array_elements(q.options) with ordinality as t(value, ord)
    where value->>'id' = q.correct_option_ids[1];

    v_offset := (q.domain_order * 3 + q.competency_order * 2 + q.level) % jsonb_array_length(q.options);
    if v_offset = 0 then
      continue; -- already in the position this offset would give it
    end if;

    select array_agg(value->>'label' order by ord) into v_labels
    from jsonb_array_elements(q.options) with ordinality as t(value, ord);

    -- Keep ids a, b, c, d in place and rotate the labels beneath them.
    v_new := '[]'::jsonb;
    for i in 0 .. array_length(v_labels, 1) - 1 loop
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', chr(97 + i),
        'label', v_labels[((i + v_offset) % array_length(v_labels, 1)) + 1]
      ));
    end loop;

    update public.diagnostic_questions set options = v_new where id = q.id;

    -- The correct label moved to the slot i where (i + offset) ≡ correct_index.
    update public.diagnostic_answer_keys
    set correct_option_ids = array[
      chr(97 + ((v_correct_index - v_offset + array_length(v_labels, 1)) % array_length(v_labels, 1)))
    ]
    where question_id = q.id;
  end loop;
end $$;
