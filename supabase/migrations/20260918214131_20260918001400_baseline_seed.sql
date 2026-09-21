-- W02 Batch A — reference content for the baseline diagnostic.
-- Operator-authored catalogue data, seeded so the engine has something real to
-- measure. Idempotent: re-running updates copy rather than duplicating rows.

-- ------------------------------------------------------------------ domains ---
insert into public.competency_domains (slug, name, description, sort_order) values
  ('ai-foundations', 'AI foundations',
   'How AI systems actually work, and where they stop working.', 1),
  ('prompting', 'Prompting and AI tooling',
   'Getting useful, checkable results out of AI tools.', 2),
  ('data-literacy', 'Data literacy',
   'Reading, questioning and trusting data.', 3),
  ('applied-ai', 'Applied and responsible AI',
   'Turning AI into work that solves a real problem, responsibly.', 4)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

-- ------------------------------------------------------------- competencies ---
insert into public.competencies (domain_id, slug, name, description, target_level, is_technical, sort_order, evidence_requirement)
select d.id, v.slug, v.name, v.description, v.target_level, v.is_technical, v.sort_order, v.evidence
from (values
  ('ai-foundations', 'ai-concepts', 'How AI systems work',
   'Explain what a model is doing when it produces an answer, in plain terms.', 3, false, 1,
   'A written explanation of a model''s behaviour on a case you tested yourself.'),
  ('ai-foundations', 'ai-limitations', 'Recognising AI limitations',
   'Spot hallucination, stale knowledge and confident wrongness before acting on it.', 3, false, 2,
   'A documented case where you caught and corrected a model error.'),
  ('prompting', 'prompt-design', 'Prompt design',
   'Structure a request so the output is useful and checkable.', 4, false, 1,
   'A prompt iteration log showing what you changed and why the output improved.'),
  ('prompting', 'ai-tool-workflow', 'Working with AI tools',
   'Fit AI into a workflow, with a verification step you actually perform.', 3, false, 2,
   'A workflow description naming the verification step and what it catches.'),
  ('data-literacy', 'data-interpretation', 'Interpreting data',
   'Read a chart or table and state what it does and does not support.', 3, false, 1,
   'An analysis of a real dataset, with the claims it cannot support stated.'),
  ('data-literacy', 'data-quality', 'Data quality and bias',
   'Judge whether data is fit for the question being asked of it.', 3, false, 2,
   'A data critique identifying a concrete sampling or measurement problem.'),
  ('applied-ai', 'applied-ai-projects', 'Applying AI to a problem',
   'Scope a problem, pick an approach, and show the result works.', 4, true, 1,
   'A built project with a stated problem, approach and evaluation.'),
  ('applied-ai', 'ai-ethics', 'Responsible AI use',
   'Handle attribution, privacy and academic integrity when using AI.', 3, false, 2,
   'A reflection on a decision where you changed course for an integrity reason.')
) as v(domain_slug, slug, name, description, target_level, is_technical, sort_order, evidence)
join public.competency_domains d on d.slug = v.domain_slug
on conflict (slug) do update set
  name = excluded.name, description = excluded.description,
  target_level = excluded.target_level, sort_order = excluded.sort_order,
  evidence_requirement = excluded.evidence_requirement;

-- ------------------------------------------------------------------- levels ---
-- Shared level ladder. Operators refine per-competency wording later; the
-- descriptors are deliberately generic rather than invented specifics.
insert into public.competency_levels (competency_id, level, label, descriptor)
select c.id, l.level, l.label, replace(l.descriptor, '{{name}}', lower(c.name))
from public.competencies c
cross join (values
  (1::smallint, 'Aware', 'Has encountered {{name}} but cannot yet apply it unaided.'),
  (2::smallint, 'Developing', 'Can handle {{name}} in familiar situations with guidance.'),
  (3::smallint, 'Capable', 'Applies {{name}} reliably and independently in normal work.'),
  (4::smallint, 'Proficient', 'Handles {{name}} in unfamiliar situations and explains the trade-offs.'),
  (5::smallint, 'Leading', 'Sets the standard for {{name}} and can teach it to others.')
) as l(level, label, descriptor)
on conflict (competency_id, level) do update set
  label = excluded.label, descriptor = excluded.descriptor;

-- ------------------------------------------------------------- prerequisites ---
insert into public.competency_prerequisites (competency_id, prerequisite_id, minimum_level)
select c.id, p.id, v.minimum_level
from (values
  ('prompt-design', 'ai-concepts', 2::smallint),
  ('ai-tool-workflow', 'prompt-design', 2::smallint),
  ('data-quality', 'data-interpretation', 2::smallint),
  ('ai-ethics', 'ai-limitations', 2::smallint),
  ('applied-ai-projects', 'prompt-design', 2::smallint),
  ('applied-ai-projects', 'data-interpretation', 2::smallint)
) as v(competency_slug, prerequisite_slug, minimum_level)
join public.competencies c on c.slug = v.competency_slug
join public.competencies p on p.slug = v.prerequisite_slug
on conflict (competency_id, prerequisite_id) do update set minimum_level = excluded.minimum_level;

-- ---------------------------------------------------------------- diagnostic ---
insert into public.diagnostics (slug, title, description, status, is_baseline, max_questions)
values (
  'baseline-ai-literacy',
  'Where you stand with AI',
  'A short adaptive baseline across eight competencies. Two questions each — it steps up when you are right and down when you are not, so it finds your level rather than testing you on everything.',
  'published', true, 16
)
on conflict (slug) do update set
  title = excluded.title, description = excluded.description, max_questions = excluded.max_questions;

-- ----------------------------------------------------------------- questions ---
insert into public.diagnostic_questions (diagnostic_id, competency_id, level, kind, prompt, options, explanation, sort_order)
select d.id, c.id, v.level, 'single_choice', v.prompt, v.options::jsonb, v.explanation, v.level
from (values
  -- ai-concepts
  ('ai-concepts', 1::smallint, 'A language model answers a question you ask it. What is it fundamentally doing?',
   '[{"id":"a","label":"Looking the answer up in a database of facts"},{"id":"b","label":"Predicting likely next text based on patterns it learned"},{"id":"c","label":"Searching the live internet each time"},{"id":"d","label":"Running a logical proof over stored rules"}]',
   'Models generate likely continuations from learned patterns; they are not fact databases.'),
  ('ai-concepts', 2::smallint, 'Why can the same prompt produce different answers on two runs?',
   '[{"id":"a","label":"The model is broken"},{"id":"b","label":"Generation samples from a probability distribution"},{"id":"c","label":"It relearns from scratch each time"},{"id":"d","label":"Your account settings changed"}]',
   'Sampling makes generation non-deterministic unless temperature is pinned to zero.'),
  ('ai-concepts', 4::smallint, 'A model performs well on your test examples but poorly on new ones. The most likely explanation is:',
   '[{"id":"a","label":"The model is too small"},{"id":"b","label":"Your examples leaked into how you tuned it, so the test no longer measures generalisation"},{"id":"c","label":"You need a longer prompt"},{"id":"d","label":"The data was too clean"}]',
   'Tuning against your evaluation set stops it measuring generalisation.'),
  -- ai-limitations
  ('ai-limitations', 1::smallint, 'A model gives you a confident citation to a paper. What should you do first?',
   '[{"id":"a","label":"Use it — confident answers are reliable"},{"id":"b","label":"Check the paper exists and says what was claimed"},{"id":"c","label":"Ask the model if it is sure"},{"id":"d","label":"Rephrase and use whichever answer appears twice"}]',
   'Fabricated citations are common, and confidence is not evidence. Verify at the source.'),
  ('ai-limitations', 2::smallint, 'Which task is a general language model least reliable at, unaided?',
   '[{"id":"a","label":"Rewriting a paragraph more clearly"},{"id":"b","label":"Giving today''s exchange rate"},{"id":"c","label":"Explaining a concept you name"},{"id":"d","label":"Suggesting names for a project"}]',
   'Anything requiring current, external state is outside a model''s training data.'),
  ('ai-limitations', 4::smallint, 'You need AI help on a topic where being wrong is costly. The soundest approach is:',
   '[{"id":"a","label":"Use the strongest available model and trust it"},{"id":"b","label":"Have it produce reasoning and sources you verify independently before acting"},{"id":"c","label":"Ask three models and take the majority"},{"id":"d","label":"Avoid AI entirely for the whole task"}]',
   'Verifiability, not model choice or voting, is what makes the output safe to act on.'),
  -- prompt-design
  ('prompt-design', 1::smallint, 'Which request is most likely to produce a useful answer?',
   '[{"id":"a","label":"\"Write about climate.\""},{"id":"b","label":"\"Summarise this 2-page report for a non-expert in 5 bullets, each under 20 words.\""},{"id":"c","label":"\"Tell me everything about climate change.\""},{"id":"d","label":"\"Climate?\""}]',
   'Naming the audience, format and length removes the ambiguity the model would otherwise guess at.'),
  ('prompt-design', 2::smallint, 'Your output is close but the tone is wrong. The most effective next step is:',
   '[{"id":"a","label":"Start over with a brand new prompt"},{"id":"b","label":"Give a short example of the tone you want and ask it to match that"},{"id":"c","label":"Add \"be better\" to the prompt"},{"id":"d","label":"Switch tools"}]',
   'A concrete example communicates tone far more reliably than an adjective.'),
  ('prompt-design', 4::smallint, 'You need consistent structured output across 500 items. The most reliable design is:',
   '[{"id":"a","label":"A long friendly instruction repeated each time"},{"id":"b","label":"A fixed schema, a worked example, and a validation step that rejects malformed output"},{"id":"c","label":"Asking it to \"be consistent\""},{"id":"d","label":"Running each item twice and comparing"}]',
   'At volume, correctness comes from a schema plus validation, not from prompt wording alone.'),
  -- ai-tool-workflow
  ('ai-tool-workflow', 1::smallint, 'You used AI to draft part of an assignment. What belongs in your process?',
   '[{"id":"a","label":"Submit as-is if it reads well"},{"id":"b","label":"Review, verify claims, edit into your own understanding, and disclose per your institution''s rules"},{"id":"c","label":"Paraphrase it so detection tools do not flag it"},{"id":"d","label":"Nothing further"}]',
   'Reviewing, verifying and disclosing is what makes AI-assisted work honest and yours.'),
  ('ai-tool-workflow', 2::smallint, 'Where does a verification step belong in an AI-assisted workflow?',
   '[{"id":"a","label":"Nowhere, if the tool is good"},{"id":"b","label":"Between the model''s output and any action taken on it"},{"id":"c","label":"Only when the output looks wrong"},{"id":"d","label":"After the work has been submitted"}]',
   'Verification only protects you if it sits before the output is acted on.'),
  ('ai-tool-workflow', 4::smallint, 'An AI step in your workflow fails intermittently on real inputs. The best response is:',
   '[{"id":"a","label":"Retry until it works"},{"id":"b","label":"Characterise which inputs fail, then handle that class explicitly or route it to a human"},{"id":"c","label":"Remove the step"},{"id":"d","label":"Increase the prompt length"}]',
   'Knowing the failure class is what lets you design a real fallback instead of hoping.'),
  -- data-interpretation
  ('data-interpretation', 1::smallint, 'A chart shows ice-cream sales and drowning deaths rising together. What follows?',
   '[{"id":"a","label":"Ice cream causes drowning"},{"id":"b","label":"They move together; something else, like summer, may drive both"},{"id":"c","label":"The data is wrong"},{"id":"d","label":"Drowning drives ice-cream sales"}]',
   'Correlation with a plausible common cause is not evidence of causation.'),
  ('data-interpretation', 2::smallint, 'A survey of 40 students in one department reports 82% support. What can you claim?',
   '[{"id":"a","label":"82% of the university supports it"},{"id":"b","label":"82% of those 40 responded that way, and it may not generalise"},{"id":"c","label":"Nothing at all"},{"id":"d","label":"Support is rising"}]',
   'The sample bounds the claim; a single department cannot speak for the university.'),
  ('data-interpretation', 4::smallint, 'Average completion time improved after a change, but the median did not. The most likely reading is:',
   '[{"id":"a","label":"The change worked for everyone"},{"id":"b","label":"A few extreme cases moved, so the typical learner saw little change"},{"id":"c","label":"The data is corrupt"},{"id":"d","label":"Mean and median cannot differ"}]',
   'A mean shifting without the median points to movement in the tails, not the middle.'),
  -- data-quality
  ('data-quality', 1::smallint, 'Which is the clearest sign data may not fit your question?',
   '[{"id":"a","label":"It is large"},{"id":"b","label":"It was collected from a group unlike the one you are asking about"},{"id":"c","label":"It is in a spreadsheet"},{"id":"d","label":"It has more than one column"}]',
   'Fitness for purpose is about who and what was measured, not size or format.'),
  ('data-quality', 2::smallint, 'A hiring model trained on past hires favours one group. The most likely cause is:',
   '[{"id":"a","label":"The algorithm chose to discriminate"},{"id":"b","label":"It learned patterns present in historical hiring decisions"},{"id":"c","label":"Too little training data"},{"id":"d","label":"A software bug"}]',
   'Models reproduce the patterns in their training data, including past human bias.'),
  ('data-quality', 4::smallint, 'Your dataset has 30% missing values in a key field. The soundest first move is:',
   '[{"id":"a","label":"Drop those rows and proceed"},{"id":"b","label":"Find out why they are missing, because the reason decides whether dropping biases the result"},{"id":"c","label":"Fill them with the column average"},{"id":"d","label":"Fill them with zero"}]',
   'Whether missingness is random or systematic determines which handling is valid.'),
  -- applied-ai-projects
  ('applied-ai-projects', 1::smallint, 'What should a project start from?',
   '[{"id":"a","label":"The technology you want to use"},{"id":"b","label":"A problem someone actually has, stated clearly"},{"id":"c","label":"The dataset that is easiest to download"},{"id":"d","label":"A model architecture"}]',
   'Starting from the problem is what keeps the result useful to somebody.'),
  ('applied-ai-projects', 2::smallint, 'How do you know your project worked?',
   '[{"id":"a","label":"It runs without errors"},{"id":"b","label":"You defined a measure of success beforehand and met it on data you did not tune against"},{"id":"c","label":"It looks impressive in a demo"},{"id":"d","label":"You finished on time"}]',
   'Success needs a measure agreed before you saw the result, on held-out data.'),
  ('applied-ai-projects', 4::smallint, 'Your model hits 94% accuracy on a task where 95% of cases are one class. This tells you:',
   '[{"id":"a","label":"The model is strong"},{"id":"b","label":"It may be worse than always guessing the majority class; you need class-aware metrics"},{"id":"c","label":"You need more epochs"},{"id":"d","label":"Accuracy is the right metric here"}]',
   'On imbalanced data, accuracy can sit below the majority-class baseline.'),
  -- ai-ethics
  ('ai-ethics', 1::smallint, 'You pasted a classmate''s unpublished draft into an AI tool to summarise it. The problem is:',
   '[{"id":"a","label":"Nothing, summarising is fine"},{"id":"b","label":"You shared someone else''s work with a third party without their consent"},{"id":"c","label":"Only that the summary might be wrong"},{"id":"d","label":"It was slower than reading it"}]',
   'Someone else''s unpublished work is not yours to send to a third-party service.'),
  ('ai-ethics', 2::smallint, 'Your institution allows AI use with disclosure. You used it heavily and disclosed nothing. This is:',
   '[{"id":"a","label":"Fine, since AI use is allowed"},{"id":"b","label":"A breach — the permission was conditional on disclosure"},{"id":"c","label":"Fine if the work is good"},{"id":"d","label":"Only a problem if you are asked"}]',
   'Conditional permission is not permission once you drop the condition.'),
  ('ai-ethics', 4::smallint, 'You build a tool that screens applications. The strongest safeguard is:',
   '[{"id":"a","label":"Removing names from the input"},{"id":"b","label":"Measuring outcomes across groups, keeping a human decision point, and being able to explain any rejection"},{"id":"c","label":"Using the largest model available"},{"id":"d","label":"Telling applicants AI was used"}]',
   'Measurement, a human decision point and explainability address the actual harm; hiding a field does not.')
) as v(competency_slug, level, prompt, options, explanation)
join public.competencies c on c.slug = v.competency_slug
cross join (select id from public.diagnostics where slug = 'baseline-ai-literacy') d
on conflict do nothing;

-- --------------------------------------------------------------- answer keys ---
insert into public.diagnostic_answer_keys (question_id, correct_option_ids)
select q.id, array['b']
from public.diagnostic_questions q
join public.diagnostics d on d.id = q.diagnostic_id
where d.slug = 'baseline-ai-literacy'
on conflict (question_id) do update set correct_option_ids = excluded.correct_option_ids;
