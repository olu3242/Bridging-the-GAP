-- W01 Batch A — E2 Learner Profile Engine, minimum surface required so that
-- onboarding persists real learner intent instead of a mocked completion.
-- W02 extends this table; it does not replace it.

do $$ begin
  create type public.btg_experience_level as enum ('beginner','developing','intermediate','advanced');
exception when duplicate_object then null; end $$;

create table if not exists public.learner_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  primary_goal text not null check (char_length(btrim(primary_goal)) between 3 and 160),
  focus_areas text[] not null default '{}'::text[]
    check (array_length(focus_areas, 1) is null or array_length(focus_areas, 1) <= 8),
  experience_level public.btg_experience_level not null default 'beginner',
  weekly_hours smallint not null default 5 check (weekly_hours between 1 and 60),
  target_outcome text check (target_outcome is null or char_length(target_outcome) <= 400),
  education_stage text check (education_stage is null or char_length(education_stage) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.learner_profiles is 'E2: learner goals, focus and availability captured at onboarding.';

drop trigger if exists learner_profiles_touch_updated_at on public.learner_profiles;
create trigger learner_profiles_touch_updated_at before update on public.learner_profiles
  for each row execute function btg.touch_updated_at();

alter table public.learner_profiles enable row level security;

drop policy if exists learner_profiles_select on public.learner_profiles;
create policy learner_profiles_select on public.learner_profiles for select to authenticated
using (
  profile_id = auth.uid()
  or btg.is_operator()
  or exists (
    select 1 from public.memberships m
    where m.profile_id = public.learner_profiles.profile_id and m.status = 'active'
      and m.organization_id in (select btg.governed_org_ids())
  )
);

drop policy if exists learner_profiles_write on public.learner_profiles;
create policy learner_profiles_write on public.learner_profiles for insert to authenticated
with check (profile_id = auth.uid());

drop policy if exists learner_profiles_update on public.learner_profiles;
create policy learner_profiles_update on public.learner_profiles for update to authenticated
using (profile_id = auth.uid()) with check (profile_id = auth.uid());

grant select, insert, update on public.learner_profiles to authenticated;
