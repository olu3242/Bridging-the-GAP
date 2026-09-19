-- E6 reference content: one module per seeded competency, three activities each.
insert into public.learning_modules (competency_id, slug, title, summary, target_level, estimated_minutes, sort_order)
select c.id, v.slug, v.title, v.summary, v.target_level, v.minutes, 1
from (values
  ('ai-concepts', 'module-ai-concepts', 'What a model is actually doing',
   'Build a working mental model of generation, so you can predict where it breaks.', 3, 45),
  ('ai-limitations', 'module-ai-limitations', 'Catching confident wrongness',
   'Practise spotting hallucination, stale knowledge and unsupported confidence.', 3, 40),
  ('prompt-design', 'module-prompt-design', 'Prompts that produce checkable work',
   'Structure, examples and constraints — and how to iterate deliberately.', 4, 60),
  ('ai-tool-workflow', 'module-ai-tool-workflow', 'Putting AI in a workflow you trust',
   'Design the verification step before you rely on the output.', 3, 40),
  ('data-interpretation', 'module-data-interpretation', 'Reading data honestly',
   'What a chart supports, what it does not, and how to tell the difference.', 3, 50),
  ('data-quality', 'module-data-quality', 'Fitness for purpose',
   'Sampling, measurement and the bias your data inherited.', 3, 45),
  ('applied-ai-projects', 'module-applied-ai-projects', 'From problem to shipped result',
   'Scope, approach, evaluation — and evidence someone else can check.', 4, 90),
  ('ai-ethics', 'module-ai-ethics', 'Integrity when you use AI',
   'Attribution, privacy and the decisions that deserve a second thought.', 3, 35)
) as v(competency_slug, slug, title, summary, target_level, minutes)
join public.competencies c on c.slug = v.competency_slug
on conflict (slug) do update set
  title = excluded.title, summary = excluded.summary, target_level = excluded.target_level;

-- Three activities per module: a lesson, a lab that asks for work, a quiz.
insert into public.learning_activities (module_id, slug, title, kind, body, requires_output, estimated_minutes, sort_order)
select m.id, v.slug, v.title, v.kind::public.btg_activity_kind, v.body, v.requires_output, v.minutes, v.sort_order
from public.learning_modules m
cross join (values
  ('lesson', 'Core idea', 'lesson',
   'Read the core idea for this competency and write down, in one sentence, where you expect it to break in practice. You will test that expectation in the lab.',
   false, 12, 1),
  ('lab', 'Try it and record what happened', 'lab',
   'Run the technique on something real from your own work or study. Record what you did, what came back, and what you changed as a result. This output is kept and can be attached to a project submission later.',
   true, 25, 2),
  ('check', 'Check your understanding', 'quiz',
   'Answer the check question in your own words: what would make you distrust a result in this area, and what would you do about it?',
   true, 8, 3)
) as v(slug, title, kind, body, requires_output, minutes, sort_order)
where m.slug like 'module-%'
on conflict (module_id, slug) do update set
  title = excluded.title, body = excluded.body, requires_output = excluded.requires_output;
