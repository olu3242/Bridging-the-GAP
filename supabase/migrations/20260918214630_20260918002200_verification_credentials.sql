-- E10 Verification, E11 Verified Skills, E12 Credentials.
-- Verification is human-decided and rubric-scored; a verified skill traces to
-- evidence, rubric, reviewer, decision and timestamp; a credential requires
-- qualifying verified skills. No AI-only verification anywhere.

do $$ begin
  create type public.btg_review_status as enum ('pending','in_review','approved','rejected','revision_required');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_credential_status as enum ('issued','revoked','expired');
exception when duplicate_object then null; end $$;

create table if not exists public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence(id) on delete cascade,
  reviewer_profile_id uuid references public.profiles(id) on delete set null,
  status public.btg_review_status not null default 'pending',
  assigned_at timestamptz not null default now(),
  claimed_at timestamptz,
  decided_at timestamptz,
  /* The reviewer's reasoning. Required on every decision. */
  rationale text check (rationale is null or char_length(btrim(rationale)) >= 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_assignments_decision_needs_reviewer check (
    status not in ('approved','rejected','revision_required')
    or (reviewer_profile_id is not null and decided_at is not null and rationale is not null)
  )
);
comment on table public.review_assignments is
  'E10: one human review of one piece of evidence. A decision cannot exist without a reviewer and a rationale.';

create unique index if not exists review_assignments_one_open
  on public.review_assignments (evidence_id) where status in ('pending','in_review');
create index if not exists review_assignments_queue_idx
  on public.review_assignments (status, assigned_at) where status in ('pending','in_review');
create index if not exists review_assignments_reviewer_idx
  on public.review_assignments (reviewer_profile_id, status);

create table if not exists public.review_scores (
  review_id uuid not null references public.review_assignments(id) on delete cascade,
  criterion_id uuid not null references public.rubric_criteria(id) on delete restrict,
  /* 1..4 against the criterion descriptor; 3+ counts as met. */
  score smallint not null check (score between 1 and 4),
  note text check (note is null or char_length(note) <= 800),
  primary key (review_id, criterion_id)
);
comment on table public.review_scores is 'E10: the per-criterion judgement behind a decision.';

-- A verified skill: the traceable claim.
create table if not exists public.verified_skills (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  level smallint not null check (level between 1 and 5),
  evidence_id uuid not null references public.evidence(id) on delete restrict,
  rubric_id uuid not null references public.rubrics(id) on delete restrict,
  review_id uuid not null references public.review_assignments(id) on delete restrict,
  reviewer_profile_id uuid not null references public.profiles(id) on delete restrict,
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  superseded_by uuid references public.verified_skills(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint verified_skills_revocation check ((revoked_at is null) = (revocation_reason is null))
);
comment on table public.verified_skills is
  'E11: a skill claim traceable to evidence, rubric, reviewer and decision. Never derived from UI state.';

create unique index if not exists verified_skills_one_live
  on public.verified_skills (profile_id, competency_id)
  where revoked_at is null and superseded_by is null;
create index if not exists verified_skills_competency_idx
  on public.verified_skills (competency_id, level) where revoked_at is null;

create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])$'),
  title text not null check (char_length(btrim(title)) between 4 and 160),
  version smallint not null default 1 check (version >= 1),
  status public.btg_credential_status not null default 'issued',
  /* The rule that was satisfied, and the skills that satisfied it. */
  criteria jsonb not null,
  issuance_basis jsonb not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  constraint credentials_revocation check ((status = 'revoked') = (revoked_at is not null)),
  constraint credentials_revocation_reason check ((revoked_at is null) = (revocation_reason is null))
);
comment on table public.credentials is
  'E12: issued only against qualifying verified skills. Issuance basis is recorded, not recomputed.';

create unique index if not exists credentials_one_live
  on public.credentials (profile_id, slug) where status = 'issued';

create table if not exists public.credential_skills (
  credential_id uuid not null references public.credentials(id) on delete cascade,
  verified_skill_id uuid not null references public.verified_skills(id) on delete restrict,
  primary key (credential_id, verified_skill_id)
);
comment on table public.credential_skills is 'E12: the verified skills a credential rests on.';

-- Credential definitions: what it takes to earn one.
create table if not exists public.credential_definitions (
  slug text primary key check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])$'),
  title text not null check (char_length(btrim(title)) between 4 and 160),
  description text,
  /* Every competency in this list must be verified at or above min_level. */
  required_competency_slugs text[] not null check (array_length(required_competency_slugs, 1) >= 1),
  min_level smallint not null default 3 check (min_level between 1 and 5),
  status public.btg_diagnostic_status not null default 'published',
  created_at timestamptz not null default now()
);

insert into btg.state_transitions (machine, from_state, to_state) values
  ('review','pending','in_review'),
  ('review','pending','approved'),
  ('review','pending','rejected'),
  ('review','pending','revision_required'),
  ('review','in_review','approved'),
  ('review','in_review','rejected'),
  ('review','in_review','revision_required'),
  ('credential','issued','revoked'),
  ('credential','issued','expired')
on conflict do nothing;

drop trigger if exists review_assignments_enforce_transition on public.review_assignments;
create trigger review_assignments_enforce_transition
  before update of status on public.review_assignments
  for each row execute function btg.enforce_transition('review', 'status');

drop trigger if exists credentials_enforce_transition on public.credentials;
create trigger credentials_enforce_transition before update of status on public.credentials
  for each row execute function btg.enforce_transition('credential', 'status');

drop trigger if exists review_assignments_touch on public.review_assignments;
create trigger review_assignments_touch before update on public.review_assignments
  for each row execute function btg.touch_updated_at();

-- Verified skills and credentials are append-and-revoke, never rewritten.
create or replace function btg.reject_claim_rewrite()
returns trigger language plpgsql as $$
begin
  if new.profile_id is distinct from old.profile_id
     or new.competency_id is distinct from old.competency_id
     or new.evidence_id is distinct from old.evidence_id
     or new.review_id is distinct from old.review_id
     or new.reviewer_profile_id is distinct from old.reviewer_profile_id
     or new.level is distinct from old.level then
    raise exception 'a verified skill cannot be rewritten: revoke or supersede it'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists verified_skills_no_rewrite on public.verified_skills;
create trigger verified_skills_no_rewrite before update on public.verified_skills
  for each row execute function btg.reject_claim_rewrite();

alter table public.review_assignments enable row level security;
alter table public.review_scores enable row level security;
alter table public.verified_skills enable row level security;
alter table public.credentials enable row level security;
alter table public.credential_skills enable row level security;
alter table public.credential_definitions enable row level security;

-- Reviewers see the queue and their own work; learners see reviews of their
-- own evidence. Nobody writes directly.
drop policy if exists review_assignments_select on public.review_assignments;
create policy review_assignments_select on public.review_assignments for select to authenticated
using (
  btg.is_operator()
  or btg.has_platform_persona('reviewer')
  or exists (select 1 from public.evidence e
             where e.id = review_assignments.evidence_id and e.profile_id = auth.uid())
);

drop policy if exists review_scores_select on public.review_scores;
create policy review_scores_select on public.review_scores for select to authenticated
using (
  btg.is_operator()
  or btg.has_platform_persona('reviewer')
  or exists (select 1 from public.review_assignments r
             join public.evidence e on e.id = r.evidence_id
             where r.id = review_scores.review_id and e.profile_id = auth.uid())
);

drop policy if exists verified_skills_select on public.verified_skills;
create policy verified_skills_select on public.verified_skills for select to authenticated
using (
  profile_id = auth.uid() or btg.is_operator()
  or exists (select 1 from public.memberships m
             where m.profile_id = verified_skills.profile_id and m.status = 'active'
               and m.organization_id in (select btg.governed_org_ids()))
);

drop policy if exists credentials_select on public.credentials;
create policy credentials_select on public.credentials for select to authenticated
using (
  profile_id = auth.uid() or btg.is_operator()
  or exists (select 1 from public.memberships m
             where m.profile_id = credentials.profile_id and m.status = 'active'
               and m.organization_id in (select btg.governed_org_ids()))
);

drop policy if exists credential_skills_select on public.credential_skills;
create policy credential_skills_select on public.credential_skills for select to authenticated
using (exists (select 1 from public.credentials c where c.id = credential_skills.credential_id));

drop policy if exists credential_definitions_select on public.credential_definitions;
create policy credential_definitions_select on public.credential_definitions
  for select to authenticated using (status = 'published' or btg.is_operator());

drop policy if exists credential_definitions_write on public.credential_definitions;
create policy credential_definitions_write on public.credential_definitions for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

grant select on public.review_assignments, public.review_scores, public.verified_skills,
  public.credentials, public.credential_skills, public.credential_definitions to authenticated;
grant insert, update, delete on public.credential_definitions to authenticated;
grant all on public.review_assignments, public.review_scores, public.verified_skills,
  public.credentials, public.credential_skills, public.credential_definitions to service_role;
