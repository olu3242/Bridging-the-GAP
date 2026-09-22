-- E8/E10/E12 reference content: one brief + rubric per competency, and two
-- credential definitions that rest on verified skills.

insert into public.project_briefs (slug, competency_id, kind, title, brief, target_level, expected_evidence, estimated_hours)
select v.slug, c.id, v.kind::public.btg_project_kind, v.title, v.brief, v.target_level, v.evidence, v.hours
from (values
  ('brief-ai-concepts', 'ai-concepts', 'project', 'Explain a model''s behaviour from your own test',
   'Pick a task, run it through an AI tool several times, and document where the output changed and where it stayed stable. Explain what that tells you about how the model produces answers. Your write-up should let a classmate reproduce what you did.',
   3, 'A write-up with your test cases, the outputs you saw, and your explanation of the behaviour.', 4),
  ('brief-ai-limitations', 'ai-limitations', 'project', 'Catch a model being confidently wrong',
   'Find a real case where an AI tool produced something plausible and wrong. Show how you detected it, what the correct answer was, and what check you would add to catch that class of error next time.',
   3, 'A documented case: the wrong output, your verification, and the check you propose.', 3),
  ('brief-prompt-design', 'prompt-design', 'project', 'Iterate a prompt until the output is checkable',
   'Take a task that matters to you and iterate the prompt at least four times. Record each version, what was wrong with the output, and what you changed. End with a prompt whose output you can verify.',
   4, 'A prompt iteration log with four or more versions and the reasoning behind each change.', 5),
  ('brief-ai-tool-workflow', 'ai-tool-workflow', 'project', 'Design a workflow with a real verification step',
   'Map an AI-assisted workflow you actually use. Name the verification step, say what class of error it catches, and show it catching one.',
   3, 'A workflow description plus one worked example of the verification step doing its job.', 4),
  ('brief-data-interpretation', 'data-interpretation', 'project', 'State what a dataset does not support',
   'Take a real dataset, produce one honest finding, and then write the claims it cannot support and why. The second part matters more than the first.',
   3, 'An analysis with a stated finding and an explicit list of unsupported claims.', 5),
  ('brief-data-quality', 'data-quality', 'challenge', 'Critique a dataset''s fitness for purpose',
   'Choose a dataset and a question someone wants to answer with it. Identify a concrete sampling or measurement problem and say how it would bias the answer.',
   3, 'A data critique naming a specific problem and its effect on the conclusion.', 4),
  ('brief-applied-ai-projects', 'applied-ai-projects', 'project', 'Ship something that solves a real problem',
   'Scope a problem someone actually has, pick an approach, build it, and evaluate it against a measure you defined before you saw the result. Report honestly, including what did not work.',
   4, 'A built artefact, the pre-agreed success measure, and the evaluation against held-out data.', 20),
  ('brief-ai-ethics', 'ai-ethics', 'project', 'Document a decision you changed on integrity grounds',
   'Describe a case where you changed how you used AI for an attribution, privacy or integrity reason. Explain what you would do differently and what rule you now follow.',
   3, 'A reflection naming the decision, what changed, and the rule you adopted.', 2)
) as v(slug, competency_slug, kind, title, brief, target_level, evidence, hours)
join public.competencies c on c.slug = v.competency_slug
on conflict (slug) do update set title = excluded.title, brief = excluded.brief,
  target_level = excluded.target_level, expected_evidence = excluded.expected_evidence;

insert into public.rubrics (brief_id, version, status)
select b.id, 1, 'published' from public.project_briefs b
on conflict (brief_id, version) do nothing;

-- Four criteria per rubric: three required, one stretch.
insert into public.rubric_criteria (rubric_id, code, label, descriptor, weight, is_required, sort_order)
select r.id, v.code, v.label, v.descriptor, v.weight, v.required, v.sort_order
from public.rubrics r
cross join (values
  ('evidence_present', 'The work exists and is attributable',
   'The submission contains the artefact or a working reference to it, and it is clearly the learner''s own work.', 2.00, true, 1),
  ('meets_brief', 'It does what the brief asked',
   'Every element the brief required is present and addressed, not gestured at.', 2.00, true, 2),
  ('reasoning_visible', 'The reasoning can be followed',
   'A reader can see why the learner made the choices they made, and could reproduce the result.', 1.50, true, 3),
  ('goes_further', 'It goes beyond the minimum',
   'The learner identified something the brief did not ask for — a limitation, an improvement, a second test.', 1.00, false, 4)
) as v(code, label, descriptor, weight, required, sort_order)
on conflict (rubric_id, code) do update set label = excluded.label, descriptor = excluded.descriptor;

insert into public.credential_definitions (slug, title, description, required_competency_slugs, min_level)
values
  ('ai-foundations-certificate', 'AI Foundations',
   'Awarded when both foundation competencies are verified from reviewed evidence.',
   array['ai-concepts','ai-limitations'], 3),
  ('applied-ai-practitioner', 'Applied AI Practitioner',
   'Awarded for verified evidence across prompting, data and a shipped applied project.',
   array['prompt-design','data-interpretation','applied-ai-projects'], 3)
on conflict (slug) do update set title = excluded.title, description = excluded.description,
  required_competency_slugs = excluded.required_competency_slugs, min_level = excluded.min_level;
