-- E13 Mentorship. Recommendations read persisted learner state and say why.
-- E14 Community is deliberately scoped to cohorts a learner actually belongs
-- to, rather than a fabricated social network.

do $$ begin
  create type public.btg_mentorship_status as enum
    ('requested','accepted','declined','active','completed','ended');
exception when duplicate_object then null; end $$;

create table if not exists public.mentor_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  headline text not null check (char_length(btrim(headline)) between 8 and 200),
  bio text check (bio is null or char_length(bio) <= 2000),
  /* Competencies this mentor can actually coach. */
  years_experience smallint check (years_experience is null or years_experience between 0 and 60),
  /* Sessions they can hold per month; 0 means unavailable. */
  monthly_capacity smallint not null default 2 check (monthly_capacity between 0 and 40),
  timezone text not null default 'UTC',
  is_accepting boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.mentor_profiles is 'E13: a mentor''s own record. Requires the mentor persona.';

create table if not exists public.mentor_expertise (
  profile_id uuid not null references public.mentor_profiles(profile_id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  /* The highest level this mentor can coach toward. */
  max_level smallint not null default 4 check (max_level between 1 and 5),
  primary key (profile_id, competency_id)
);

create table if not exists public.mentorships (
  id uuid primary key default gen_random_uuid(),
  mentor_profile_id uuid not null references public.mentor_profiles(profile_id) on delete cascade,
  learner_profile_id uuid not null references public.profiles(id) on delete cascade,
  competency_id uuid references public.competencies(id) on delete set null,
  status public.btg_mentorship_status not null default 'requested',
  /* Why this pairing was proposed — the persisted factors, not a score. */
  rationale jsonb not null default '{}'::jsonb,
  learner_message text check (learner_message is null or char_length(learner_message) <= 1000),
  mentor_response text check (mentor_response is null or char_length(mentor_response) <= 1000),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint mentorships_not_self check (mentor_profile_id <> learner_profile_id)
);
comment on table public.mentorships is 'E13: one mentoring relationship with an explicit lifecycle.';

create unique index if not exists mentorships_one_open
  on public.mentorships (mentor_profile_id, learner_profile_id)
  where status in ('requested','accepted','active');
create index if not exists mentorships_learner_idx on public.mentorships (learner_profile_id, status);
create index if not exists mentorships_mentor_idx on public.mentorships (mentor_profile_id, status);

create table if not exists public.mentor_sessions (
  id uuid primary key default gen_random_uuid(),
  mentorship_id uuid not null references public.mentorships(id) on delete cascade,
  scheduled_for timestamptz not null,
  duration_minutes smallint not null default 30 check (duration_minutes between 15 and 180),
  agenda text check (agenda is null or char_length(agenda) <= 1000),
  held boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.mentor_sessions is 'E13: a scheduled session, visible to both sides.';

-- Notes live in their own relation rather than a hidden column: a column-level
-- grant would have withheld them from the mentor who wrote them too, because a
-- grant applies to the role and cannot distinguish rows.
create table if not exists public.mentor_session_notes (
  session_id uuid primary key references public.mentor_sessions(id) on delete cascade,
  mentor_profile_id uuid not null references public.profiles(id) on delete cascade,
  notes text not null check (char_length(btrim(notes)) >= 1 and char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.mentor_session_notes is
  'E13: the mentor''s private record of a session. Not the learner''s to read.';

insert into btg.state_transitions (machine, from_state, to_state) values
  ('mentorship','requested','accepted'),
  ('mentorship','requested','declined'),
  ('mentorship','accepted','active'),
  ('mentorship','accepted','ended'),
  ('mentorship','active','completed'),
  ('mentorship','active','ended')
on conflict do nothing;

drop trigger if exists mentorships_enforce_transition on public.mentorships;
create trigger mentorships_enforce_transition before update of status on public.mentorships
  for each row execute function btg.enforce_transition('mentorship', 'status');

do $$ declare t text;
begin
  foreach t in array array['mentor_profiles','mentorships'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I
                      for each row execute function btg.touch_updated_at()', t, t);
  end loop;
end $$;

-- ------------------------------------------------- community (cohort scope) ---
create table if not exists public.cohorts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])$'),
  name text not null check (char_length(btrim(name)) between 3 and 160),
  description text,
  starts_on date,
  ends_on date,
  status public.btg_diagnostic_status not null default 'published',
  created_at timestamptz not null default now(),
  constraint cohorts_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
comment on table public.cohorts is 'E14: the smallest real community unit — a group a learner belongs to.';

create table if not exists public.cohort_members (
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (cohort_id, profile_id)
);

alter table public.mentor_profiles enable row level security;
alter table public.mentor_expertise enable row level security;
alter table public.mentorships enable row level security;
alter table public.mentor_sessions enable row level security;
alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;

-- A mentor directory is visible to signed-in learners; only accepting mentors.
drop policy if exists mentor_profiles_select on public.mentor_profiles;
create policy mentor_profiles_select on public.mentor_profiles for select to authenticated
using (is_accepting or profile_id = auth.uid() or btg.is_operator());

drop policy if exists mentor_profiles_self_write on public.mentor_profiles;
create policy mentor_profiles_self_write on public.mentor_profiles for all to authenticated
using (profile_id = auth.uid() or btg.is_operator())
with check (profile_id = auth.uid() or btg.is_operator());

drop policy if exists mentor_expertise_select on public.mentor_expertise;
create policy mentor_expertise_select on public.mentor_expertise for select to authenticated
using (true);

drop policy if exists mentor_expertise_self_write on public.mentor_expertise;
create policy mentor_expertise_self_write on public.mentor_expertise for all to authenticated
using (profile_id = auth.uid() or btg.is_operator())
with check (profile_id = auth.uid() or btg.is_operator());

drop policy if exists mentorships_select on public.mentorships;
create policy mentorships_select on public.mentorships for select to authenticated
using (learner_profile_id = auth.uid() or mentor_profile_id = auth.uid() or btg.is_operator());

-- Both sides of an accepted mentorship can see each other's profile.
drop policy if exists profiles_select_mentorship on public.profiles;
create policy profiles_select_mentorship on public.profiles for select to authenticated
using (
  exists (
    select 1 from public.mentorships m
    where m.status in ('requested','accepted','active','completed')
      and ((m.learner_profile_id = auth.uid() and m.mentor_profile_id = public.profiles.id)
        or (m.mentor_profile_id = auth.uid() and m.learner_profile_id = public.profiles.id))
  )
);

-- A mentor may read the permitted progress of a learner they actually mentor.
drop policy if exists learner_competencies_select_mentor on public.learner_competencies;
create policy learner_competencies_select_mentor on public.learner_competencies
  for select to authenticated
using (
  exists (
    select 1 from public.mentorships m
    where m.mentor_profile_id = auth.uid()
      and m.learner_profile_id = public.learner_competencies.profile_id
      and m.status in ('accepted','active')
  )
);

drop policy if exists mentor_sessions_select on public.mentor_sessions;
create policy mentor_sessions_select on public.mentor_sessions for select to authenticated
using (
  exists (select 1 from public.mentorships m
          where m.id = mentor_sessions.mentorship_id
            and (m.learner_profile_id = auth.uid() or m.mentor_profile_id = auth.uid()))
  or btg.is_operator()
);

drop policy if exists cohorts_select on public.cohorts;
create policy cohorts_select on public.cohorts for select to authenticated
using (
  btg.is_operator()
  or btg.is_org_admin(organization_id)
  or exists (select 1 from public.cohort_members cm
             where cm.cohort_id = cohorts.id and cm.profile_id = auth.uid())
);

drop policy if exists cohorts_write on public.cohorts;
create policy cohorts_write on public.cohorts for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

-- A learner sees who else is in a cohort they belong to, and nothing more.
drop policy if exists cohort_members_select on public.cohort_members;
create policy cohort_members_select on public.cohort_members for select to authenticated
using (
  btg.is_operator()
  or exists (select 1 from public.cohort_members mine
             where mine.cohort_id = cohort_members.cohort_id and mine.profile_id = auth.uid())
);

grant select on public.mentor_profiles, public.mentor_expertise, public.mentorships,
  public.mentor_sessions, public.cohorts, public.cohort_members to authenticated;
grant insert, update, delete on public.mentor_profiles, public.mentor_expertise to authenticated;
grant insert, update, delete on public.cohorts to authenticated;
grant all on public.mentor_profiles, public.mentor_expertise, public.mentorships,
  public.mentor_sessions, public.cohorts, public.cohort_members to service_role;

alter table public.mentor_session_notes enable row level security;

drop policy if exists mentor_session_notes_mentor_only on public.mentor_session_notes;
create policy mentor_session_notes_mentor_only on public.mentor_session_notes
  for all to authenticated
using (mentor_profile_id = auth.uid() or btg.is_operator())
with check (mentor_profile_id = auth.uid() or btg.is_operator());

grant select, insert, update, delete on public.mentor_session_notes to authenticated;
grant all on public.mentor_session_notes to service_role;
