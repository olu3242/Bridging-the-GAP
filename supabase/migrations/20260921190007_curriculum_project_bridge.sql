-- A capstone checks multiple competencies. Each check reuses a canonical
-- single-competency brief, project, evidence and review; no blanket skill grant.
create table public.curriculum_project_briefs (
  activity_id uuid not null references public.curriculum_lessons(activity_id),
  competency_id uuid not null references public.competencies(id),
  brief_id uuid not null unique references public.project_briefs(id),
  primary key(activity_id,competency_id)
);
alter table public.curriculum_project_briefs enable row level security;
create policy curriculum_project_briefs_read on public.curriculum_project_briefs for select to authenticated
using(exists(select 1 from public.curriculum_lessons l where l.activity_id=curriculum_project_briefs.activity_id));
grant select on public.curriculum_project_briefs to authenticated;
grant all on public.curriculum_project_briefs to service_role;

insert into public.project_briefs(id,slug,competency_id,title,brief,expected_evidence,target_level,status)
select md5('curriculum-project:'||(p->>'project_id')||':'||c.slug)::uuid,
 'curriculum-v1-'||lower(p->>'lesson_id')||'-'||c.slug,c.id,
 left((p->>'brief')||' — '||c.name,160),
 (p->>'problem')||E'\nRequirements:\n'||(select string_agg(value,E'\n') from jsonb_array_elements_text(p->'requirements'))||
 E'\nCompetency standards:\n'||(select string_agg(value,E'\n') from jsonb_array_elements_text(k->'standard')),
 (select string_agg(value,E'\n') from jsonb_array_elements_text(p->'deliverables'))||E'\n'||(k->>'evidence_requirement'),
 (k->>'proficiency_target')::smallint,'draft'
from btg.curriculum_manifests m cross join lateral jsonb_array_elements(m.document->'projects') p
cross join lateral jsonb_array_elements(p->'competency_checks') k
join public.competencies c on c.slug=k->>'competency_id'
where m.version=1 on conflict(slug) do nothing;

insert into public.curriculum_project_briefs(activity_id,competency_id,brief_id)
select l.activity_id,b.competency_id,b.id from public.curriculum_lessons l
join public.project_briefs b on b.slug like 'curriculum-v1-'||lower(l.lesson_code)||'-%'
where l.version=1 on conflict do nothing;

insert into public.rubrics(id,brief_id,version,status)
select md5('curriculum-rubric:'||brief_id::text)::uuid,brief_id,1,'draft'
from public.curriculum_project_briefs on conflict(brief_id,version) do nothing;

insert into public.rubric_criteria(id,rubric_id,code,label,descriptor,is_required,sort_order)
select md5(r.id::text||':'||(criterion->>'id'))::uuid,r.id,criterion->>'id',
 initcap(criterion->>'id'),(criterion->>'criterion')||E'\nScoring anchors (0–4): '||(criterion->'anchors')::text,true,ordinality::smallint
from public.curriculum_project_briefs b join public.curriculum_lessons l on l.activity_id=b.activity_id
join btg.curriculum_assessment_keys k on k.activity_id=l.activity_id
join public.rubrics r on r.brief_id=b.brief_id and r.version=1
cross join lateral jsonb_array_elements(k.definition#>'{answers,1,rubric}') with ordinality q(criterion,ordinality)
on conflict(rubric_id,code) do nothing;

-- Separate required criteria prevent generic artifact scores from granting skills
-- whose specific standards or deployment evidence were not actually demonstrated.
insert into public.rubric_criteria(id,rubric_id,code,label,descriptor,is_required,sort_order)
select md5(r.id::text||':competency_standards')::uuid,r.id,'competency_standards','Competency-specific evidence',
 b.brief||E'\nApprove only when every competency standard is demonstrated by traceable evidence. Otherwise request revision.',true,5
from public.curriculum_project_briefs m join public.project_briefs b on b.id=m.brief_id
join public.rubrics r on r.brief_id=b.id and r.version=1 on conflict(rubric_id,code) do nothing;

insert into public.rubric_criteria(id,rubric_id,code,label,descriptor,is_required,sort_order)
select md5(r.id::text||':deployment')::uuid,r.id,'deployment','Actual deployment and observation',
 'Inspect actual deployment, executed E2E results, security checks and observation records. A simulated release, generated claim or unexecuted plan cannot pass. Score below 3 or request revision when this evidence is missing.',true,6
from public.curriculum_project_briefs b join public.curriculum_lessons l on l.activity_id=b.activity_id
join public.rubrics r on r.brief_id=b.brief_id and r.version=1
where l.lesson_code in ('VC12','CL08') on conflict(rubric_id,code) do nothing;

create function btg.publish_curriculum_project_briefs() returns trigger
language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
  if new.status='published' then
    update project_briefs set status='published' where id in(select brief_id from curriculum_project_briefs where activity_id=new.activity_id);
    update rubrics set status='published' where brief_id in(select brief_id from curriculum_project_briefs where activity_id=new.activity_id);
  end if;
  return new;
end $$;
revoke all on function btg.publish_curriculum_project_briefs() from public,anon,authenticated;
create trigger curriculum_publish_projects after update of status on public.curriculum_lessons
for each row execute function btg.publish_curriculum_project_briefs();

create function btg.guard_curriculum_project_assignment() returns trigger
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_activity uuid;
begin
  select activity_id into v_activity from curriculum_project_briefs where brief_id=new.brief_id;
  if not found then return new; end if;
  if new.profile_id is distinct from auth.uid() then raise exception 'own project required' using errcode='42501'; end if;
  perform btg.assert_curriculum_access(v_activity);
  if not exists(select 1 from curriculum_attempts where profile_id=auth.uid() and activity_id=v_activity) then
    raise exception 'start the project lesson before assigning its evidence checks' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function btg.guard_curriculum_project_assignment() from public,anon,authenticated;
create trigger curriculum_project_assignment before insert on public.projects
for each row execute function btg.guard_curriculum_project_assignment();
