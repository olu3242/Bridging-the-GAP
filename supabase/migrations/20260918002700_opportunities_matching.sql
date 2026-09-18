-- E15 Career Opportunities, E16 Matching.
-- Matching reads persisted, verified state only. Every match records the
-- factors that produced it, so "why" is data rather than a claim.

do $$ begin
  create type public.btg_opportunity_kind as enum
    ('internship','job','fellowship','challenge','research');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_opportunity_status as enum ('draft','open','closed','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_application_status as enum
    ('draft','submitted','under_review','shortlisted','rejected','withdrawn','offered','accepted');
exception when duplicate_object then null; end $$;

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])$'),
  organization_id uuid references public.organizations(id) on delete cascade,
  kind public.btg_opportunity_kind not null default 'internship',
  title text not null check (char_length(btrim(title)) between 4 and 160),
  description text not null check (char_length(btrim(description)) >= 40),
  location text,
  is_remote boolean not null default false,
  status public.btg_opportunity_status not null default 'draft',
  /* Hours a learner needs to be able to commit. */
  weekly_hours smallint check (weekly_hours is null or weekly_hours between 1 and 60),
  closes_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.opportunities is 'E15: a real opening, owned by an organization.';

create index if not exists opportunities_open_idx on public.opportunities (status, closes_at)
  where status = 'open';

create table if not exists public.opportunity_requirements (
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  min_level smallint not null default 3 check (min_level between 1 and 5),
  /* A required competency must be verified; a desirable one lifts the match. */
  is_required boolean not null default true,
  primary key (opportunity_id, competency_id)
);
comment on table public.opportunity_requirements is
  'E15: what the opening actually needs, in competency terms.';

create table if not exists public.opportunity_matches (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  /* 0..100, computed from verified requirements met. Never a model opinion. */
  score smallint not null check (score between 0 and 100),
  /* The factors, so the learner can see exactly why. */
  matched jsonb not null default '[]'::jsonb,
  missing jsonb not null default '[]'::jsonb,
  evidence_count smallint not null default 0,
  credential_count smallint not null default 0,
  computed_at timestamptz not null default now(),
  unique (opportunity_id, profile_id)
);
comment on table public.opportunity_matches is
  'E16: an explainable match. matched/missing carry the competency-level facts behind the score.';

create index if not exists opportunity_matches_profile_idx
  on public.opportunity_matches (profile_id, score desc);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status public.btg_application_status not null default 'submitted',
  /* Snapshot of the match at apply time, so a later change cannot rewrite it. */
  match_snapshot jsonb not null default '{}'::jsonb,
  /* What the learner chose to share. Consent-gated, not automatic. */
  shared_verified_skill_ids uuid[] not null default '{}',
  note text check (note is null or char_length(note) <= 2000),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (opportunity_id, profile_id),
  constraint applications_withdrawn_consistency check ((status = 'withdrawn') = (withdrawn_at is not null))
);
comment on table public.applications is 'E15: one learner applying once to one opening.';

create index if not exists applications_opportunity_idx on public.applications (opportunity_id, status);

insert into btg.state_transitions (machine, from_state, to_state) values
  ('opportunity','draft','open'),
  ('opportunity','draft','archived'),
  ('opportunity','open','closed'),
  ('opportunity','open','archived'),
  ('opportunity','closed','open'),
  ('opportunity','closed','archived'),
  ('application','submitted','under_review'),
  ('application','submitted','withdrawn'),
  ('application','under_review','shortlisted'),
  ('application','under_review','rejected'),
  ('application','under_review','withdrawn'),
  ('application','shortlisted','offered'),
  ('application','shortlisted','rejected'),
  ('application','shortlisted','withdrawn'),
  ('application','offered','accepted'),
  ('application','offered','withdrawn')
on conflict do nothing;

drop trigger if exists opportunities_enforce_transition on public.opportunities;
create trigger opportunities_enforce_transition before update of status on public.opportunities
  for each row execute function btg.enforce_transition('opportunity', 'status');

drop trigger if exists applications_enforce_transition on public.applications;
create trigger applications_enforce_transition before update of status on public.applications
  for each row execute function btg.enforce_transition('application', 'status');

do $$ declare t text;
begin
  foreach t in array array['opportunities','applications'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I
                      for each row execute function btg.touch_updated_at()', t, t);
  end loop;
end $$;

alter table public.opportunities enable row level security;
alter table public.opportunity_requirements enable row level security;
alter table public.opportunity_matches enable row level security;
alter table public.applications enable row level security;

drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities for select to authenticated
using (status = 'open' or btg.is_operator() or btg.is_org_admin(organization_id));

drop policy if exists opportunities_write on public.opportunities;
create policy opportunities_write on public.opportunities for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

drop policy if exists opportunity_requirements_select on public.opportunity_requirements;
create policy opportunity_requirements_select on public.opportunity_requirements
  for select to authenticated
using (exists (select 1 from public.opportunities o where o.id = opportunity_requirements.opportunity_id));

drop policy if exists opportunity_requirements_write on public.opportunity_requirements;
create policy opportunity_requirements_write on public.opportunity_requirements for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

-- A learner sees their own matches. An employer sees matches for their own
-- openings only, and only for learners who applied (see applications below).
drop policy if exists opportunity_matches_select on public.opportunity_matches;
create policy opportunity_matches_select on public.opportunity_matches for select to authenticated
using (profile_id = auth.uid() or btg.is_operator());

drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications for select to authenticated
using (
  profile_id = auth.uid()
  or btg.is_operator()
  or exists (select 1 from public.opportunities o
             where o.id = applications.opportunity_id and btg.is_org_admin(o.organization_id))
);

grant select on public.opportunities, public.opportunity_requirements,
  public.opportunity_matches, public.applications to authenticated;
grant insert, update, delete on public.opportunities, public.opportunity_requirements to authenticated;
grant all on public.opportunities, public.opportunity_requirements,
  public.opportunity_matches, public.applications to service_role;
