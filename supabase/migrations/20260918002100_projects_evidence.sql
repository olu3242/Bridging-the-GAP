-- E8 Projects/Challenges, E9 Evidence.
-- A project attaches to a pathway step and a competency, carries a rubric, and
-- produces evidence. Nothing completes without governed evidence.

do $$ begin
  create type public.btg_project_status as enum
    ('assigned','started','submitted','under_review','revision_required','completed','withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_evidence_status as enum
    ('draft','submitted','under_review','accepted','rejected','superseded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_project_kind as enum ('project','challenge');
exception when duplicate_object then null; end $$;

-- Catalogue: a project brief, optionally contributed by an employer org.
create table if not exists public.project_briefs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])$'),
  competency_id uuid not null references public.competencies(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  kind public.btg_project_kind not null default 'project',
  title text not null check (char_length(btrim(title)) between 4 and 160),
  brief text not null check (char_length(btrim(brief)) >= 40),
  /* The level this brief is pitched at, and what it expects as evidence. */
  target_level smallint not null default 3 check (target_level between 1 and 5),
  expected_evidence text not null check (char_length(btrim(expected_evidence)) >= 20),
  estimated_hours smallint not null default 6 check (estimated_hours between 1 and 200),
  status public.btg_diagnostic_status not null default 'published',
  created_at timestamptz not null default now()
);
comment on table public.project_briefs is 'E8: a brief a learner can take on, tied to one competency.';

create index if not exists project_briefs_competency_idx
  on public.project_briefs (competency_id) where status = 'published';

-- Rubrics are the criteria a reviewer scores against.
create table if not exists public.rubrics (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.project_briefs(id) on delete cascade,
  version smallint not null default 1 check (version >= 1),
  status public.btg_diagnostic_status not null default 'published',
  created_at timestamptz not null default now(),
  unique (brief_id, version)
);

create table if not exists public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.rubrics(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (char_length(btrim(label)) between 4 and 160),
  descriptor text not null check (char_length(btrim(descriptor)) >= 10),
  /* Weight within the rubric; a criterion may be required to pass. */
  weight numeric(4,2) not null default 1.00 check (weight > 0 and weight <= 10),
  is_required boolean not null default true,
  sort_order smallint not null default 0,
  unique (rubric_id, code)
);
comment on table public.rubric_criteria is 'E10: what a reviewer must judge, one row per criterion.';

-- A learner's instance of a brief.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.project_briefs(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  pathway_step_id uuid references public.pathway_steps(id) on delete set null,
  status public.btg_project_status not null default 'assigned',
  attempt smallint not null default 1 check (attempt >= 1),
  assigned_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_completed_consistency check ((status = 'completed') = (completed_at is not null))
);
comment on table public.projects is 'E8: one learner working one brief.';

create unique index if not exists projects_one_open
  on public.projects (profile_id, brief_id)
  where status not in ('completed','withdrawn');
create index if not exists projects_profile_idx on public.projects (profile_id, assigned_at desc);
create index if not exists projects_step_idx on public.projects (pathway_step_id);

-- Evidence: versioned, never overwritten, always attributable.
create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  rubric_id uuid not null references public.rubrics(id) on delete restrict,
  version smallint not null check (version >= 1),
  status public.btg_evidence_status not null default 'submitted',
  /* What was produced: a narrative plus an optional external reference. */
  summary text not null check (char_length(btrim(summary)) >= 40),
  artifact_url text check (artifact_url is null or artifact_url ~ '^https?://'),
  artifact_file_id uuid references public.file_objects(id) on delete set null,
  /* Integrity metadata: what the learner declares about how it was made. */
  ai_assistance_declared boolean not null default false,
  ai_assistance_note text check (ai_assistance_note is null or char_length(ai_assistance_note) <= 1000),
  checksum text,
  submitted_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.evidence(id) on delete set null,
  unique (project_id, version),
  constraint evidence_superseded_consistency check ((status = 'superseded') = (superseded_at is not null)),
  constraint evidence_ai_note_required check (not ai_assistance_declared or ai_assistance_note is not null)
);
comment on table public.evidence is
  'E9: an immutable submission. A revision is a new version that supersedes the last.';

create index if not exists evidence_project_idx on public.evidence (project_id, version desc);
create index if not exists evidence_review_queue_idx
  on public.evidence (status, submitted_at) where status in ('submitted','under_review');
create index if not exists evidence_competency_idx on public.evidence (competency_id, profile_id);

insert into btg.state_transitions (machine, from_state, to_state) values
  ('project','assigned','started'),
  ('project','assigned','withdrawn'),
  ('project','started','submitted'),
  ('project','started','withdrawn'),
  ('project','submitted','under_review'),
  ('project','under_review','revision_required'),
  ('project','under_review','completed'),
  ('project','revision_required','submitted'),
  ('project','revision_required','withdrawn'),
  ('evidence','draft','submitted'),
  ('evidence','submitted','under_review'),
  ('evidence','submitted','superseded'),
  ('evidence','under_review','accepted'),
  ('evidence','under_review','rejected'),
  ('evidence','under_review','superseded'),
  ('evidence','rejected','superseded')
on conflict do nothing;

drop trigger if exists projects_enforce_transition on public.projects;
create trigger projects_enforce_transition before update of status on public.projects
  for each row execute function btg.enforce_transition('project', 'status');

drop trigger if exists evidence_enforce_transition on public.evidence;
create trigger evidence_enforce_transition before update of status on public.evidence
  for each row execute function btg.enforce_transition('evidence', 'status');

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function btg.touch_updated_at();

-- Evidence content is immutable once written; only lifecycle columns may move.
create or replace function btg.reject_evidence_content_change()
returns trigger language plpgsql as $$
begin
  if new.summary is distinct from old.summary
     or new.artifact_url is distinct from old.artifact_url
     or new.artifact_file_id is distinct from old.artifact_file_id
     or new.competency_id is distinct from old.competency_id
     or new.rubric_id is distinct from old.rubric_id
     or new.version is distinct from old.version
     or new.ai_assistance_declared is distinct from old.ai_assistance_declared then
    raise exception 'evidence content is immutable: submit a new version instead'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_immutable_content on public.evidence;
create trigger evidence_immutable_content before update on public.evidence
  for each row execute function btg.reject_evidence_content_change();

alter table public.project_briefs enable row level security;
alter table public.rubrics enable row level security;
alter table public.rubric_criteria enable row level security;
alter table public.projects enable row level security;
alter table public.evidence enable row level security;

drop policy if exists project_briefs_select on public.project_briefs;
create policy project_briefs_select on public.project_briefs for select to authenticated
using (status = 'published' or btg.is_operator() or btg.is_org_admin(organization_id));

drop policy if exists project_briefs_write on public.project_briefs;
create policy project_briefs_write on public.project_briefs for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

drop policy if exists rubrics_select on public.rubrics;
create policy rubrics_select on public.rubrics for select to authenticated using (true);

drop policy if exists rubrics_write on public.rubrics;
create policy rubrics_write on public.rubrics for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

drop policy if exists rubric_criteria_select on public.rubric_criteria;
create policy rubric_criteria_select on public.rubric_criteria for select to authenticated using (true);

drop policy if exists rubric_criteria_write on public.rubric_criteria;
create policy rubric_criteria_write on public.rubric_criteria for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
using (
  profile_id = auth.uid() or btg.is_operator()
  or btg.has_platform_persona('reviewer')
  or exists (select 1 from public.memberships m
             where m.profile_id = projects.profile_id and m.status = 'active'
               and m.organization_id in (select btg.governed_org_ids()))
);

-- Reviewers see the queue; learners see their own; governing orgs see members'.
drop policy if exists evidence_select on public.evidence;
create policy evidence_select on public.evidence for select to authenticated
using (
  profile_id = auth.uid() or btg.is_operator()
  or btg.has_platform_persona('reviewer')
  or exists (select 1 from public.memberships m
             where m.profile_id = evidence.profile_id and m.status = 'active'
               and m.organization_id in (select btg.governed_org_ids()))
);

grant select on public.project_briefs, public.rubrics, public.rubric_criteria,
  public.projects, public.evidence to authenticated;
grant insert, update, delete on public.project_briefs, public.rubrics, public.rubric_criteria
  to authenticated;
grant all on public.project_briefs, public.rubrics, public.rubric_criteria,
  public.projects, public.evidence to service_role;
