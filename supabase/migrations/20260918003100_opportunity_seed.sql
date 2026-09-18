-- E15 reference content: a platform-owned employer org with two real openings,
-- each stating what it needs in competency terms.

insert into public.organizations (slug, name, type, status, created_by)
values ('btg-partner-network', 'BTG Partner Network', 'employer', 'active', null)
on conflict (slug) do update set status = 'active';

insert into public.opportunities (slug, organization_id, kind, title, description, location, is_remote, status, weekly_hours)
select v.slug, o.id, v.kind::public.btg_opportunity_kind, v.title, v.description, v.location, v.remote,
       'open', v.hours
from (values
  ('applied-ai-internship-lagos', 'internship', 'Applied AI Internship',
   'A twelve-week placement working on a real internal tool with a partner team. You will scope a problem, build something that solves it, and present the evaluation. Verified evidence of prompting and data work is what gets you shortlisted.',
   'Lagos, Nigeria', false, 20),
  ('ai-literacy-research-assistant', 'research', 'AI Literacy Research Assistant',
   'Support a study on how students actually use AI tools in coursework. You will help design instruments, read transcripts, and write up findings honestly — including the parts that do not support the hypothesis.',
   'Remote', true, 10)
) as v(slug, kind, title, description, location, remote, hours)
cross join (select id from public.organizations where slug = 'btg-partner-network') o
on conflict (slug) do update set
  title = excluded.title, description = excluded.description, status = 'open';

insert into public.opportunity_requirements (opportunity_id, competency_id, min_level, is_required)
select o.id, c.id, v.min_level, v.required
from (values
  ('applied-ai-internship-lagos', 'prompt-design', 3::smallint, true),
  ('applied-ai-internship-lagos', 'applied-ai-projects', 3::smallint, true),
  ('applied-ai-internship-lagos', 'data-interpretation', 3::smallint, false),
  ('applied-ai-internship-lagos', 'ai-ethics', 3::smallint, false),
  ('ai-literacy-research-assistant', 'data-interpretation', 3::smallint, true),
  ('ai-literacy-research-assistant', 'ai-limitations', 3::smallint, true),
  ('ai-literacy-research-assistant', 'data-quality', 3::smallint, false)
) as v(opportunity_slug, competency_slug, min_level, required)
join public.opportunities o on o.slug = v.opportunity_slug
join public.competencies c on c.slug = v.competency_slug
on conflict (opportunity_id, competency_id) do update set
  min_level = excluded.min_level, is_required = excluded.is_required;
