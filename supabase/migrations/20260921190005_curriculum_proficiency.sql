-- Extend the competency graph without replacing historical descriptors or IDs.
insert into public.competency_levels(competency_id,level,label,descriptor)
select c.id,(d->>'level')::smallint,d->>'label',d->>'observable'
from btg.curriculum_manifests m
cross join lateral jsonb_array_elements(m.document->'competencies') k
cross join lateral jsonb_array_elements(k->'descriptors') d
join public.competencies c on c.slug=k->>'competency_id'
where m.version=1
on conflict(competency_id,level) do nothing;
