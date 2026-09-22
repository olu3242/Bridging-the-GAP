-- E6 Learning Engine. Consumes pathway steps; it does not re-derive
-- competency priorities. Unlocking follows the pathway, not the catalogue.

do $$ begin
  create type public.btg_activity_kind as enum ('lesson','lab','quiz','reading');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_progress_status as enum ('locked','available','in_progress','completed');
exception when duplicate_object then null; end $$;

create table if not exists public.learning_modules (
  id uuid primary key default gen_random_uuid(),
  competency_id uuid not null references public.competencies(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])$'),
  title text not null check (char_length(btrim(title)) between 4 and 160),
  summary text check (summary is null or char_length(summary) <= 600),
  /* The level this module moves a learner toward. */
  target_level smallint not null default 3 check (target_level between 1 and 5),
  estimated_minutes smallint not null default 30 check (estimated_minutes between 1 and 600),
  status public.btg_diagnostic_status not null default 'published',
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.learning_modules is 'E6: a unit of learning attached to one competency.';

create index if not exists learning_modules_competency_idx
  on public.learning_modules (competency_id, sort_order);

create table if not exists public.learning_activities (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.learning_modules(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])$'),
  title text not null check (char_length(btrim(title)) between 4 and 160),
  kind public.btg_activity_kind not null default 'lesson',
  body text not null check (char_length(btrim(body)) >= 20),
  /* Labs and quizzes ask the learner to produce something. */
  requires_output boolean not null default false,
  estimated_minutes smallint not null default 10 check (estimated_minutes between 1 and 240),
  sort_order smallint not null default 0,
  unique (module_id, slug)
);
comment on table public.learning_activities is 'E6: one step inside a module.';

create index if not exists learning_activities_module_idx
  on public.learning_activities (module_id, sort_order);

create table if not exists public.learner_module_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  module_id uuid not null references public.learning_modules(id) on delete cascade,
  /* The pathway step this work counts towards. */
  pathway_step_id uuid references public.pathway_steps(id) on delete set null,
  status public.btg_progress_status not null default 'available',
  activities_completed smallint not null default 0 check (activities_completed >= 0),
  activities_total smallint not null check (activities_total >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, module_id),
  constraint learner_module_progress_completed_consistency
    check ((status = 'completed') = (completed_at is not null))
);
comment on table public.learner_module_progress is 'E6: per-learner module state, tied to a pathway step.';

create index if not exists learner_module_progress_step_idx
  on public.learner_module_progress (pathway_step_id);

create table if not exists public.learner_activity_completions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid not null references public.learning_activities(id) on delete cascade,
  /* What the learner produced, when the activity asks for it. */
  output text check (output is null or char_length(output) <= 4000),
  completed_at timestamptz not null default now(),
  primary key (profile_id, activity_id)
);
comment on table public.learner_activity_completions is 'E6: one completed activity. Insert-only in practice.';

insert into btg.state_transitions (machine, from_state, to_state) values
  ('module_progress','locked','available'),
  ('module_progress','available','in_progress'),
  ('module_progress','in_progress','completed'),
  ('module_progress','in_progress','available')
on conflict do nothing;

drop trigger if exists learner_module_progress_enforce_transition on public.learner_module_progress;
create trigger learner_module_progress_enforce_transition
  before update of status on public.learner_module_progress
  for each row execute function btg.enforce_transition('module_progress', 'status');

drop trigger if exists learner_module_progress_touch on public.learner_module_progress;
create trigger learner_module_progress_touch before update on public.learner_module_progress
  for each row execute function btg.touch_updated_at();

alter table public.learning_modules enable row level security;
alter table public.learning_activities enable row level security;
alter table public.learner_module_progress enable row level security;
alter table public.learner_activity_completions enable row level security;

drop policy if exists learning_modules_select on public.learning_modules;
create policy learning_modules_select on public.learning_modules for select to authenticated
using (status = 'published' or btg.is_operator());

drop policy if exists learning_modules_write on public.learning_modules;
create policy learning_modules_write on public.learning_modules for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

drop policy if exists learning_activities_select on public.learning_activities;
create policy learning_activities_select on public.learning_activities for select to authenticated
using (
  btg.is_operator()
  or exists (select 1 from public.learning_modules m
             where m.id = learning_activities.module_id and m.status = 'published')
);

drop policy if exists learning_activities_write on public.learning_activities;
create policy learning_activities_write on public.learning_activities for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

drop policy if exists learner_module_progress_select on public.learner_module_progress;
create policy learner_module_progress_select on public.learner_module_progress
  for select to authenticated
using (
  profile_id = auth.uid() or btg.is_operator()
  or exists (select 1 from public.memberships m
             where m.profile_id = learner_module_progress.profile_id and m.status = 'active'
               and m.organization_id in (select btg.governed_org_ids()))
);

drop policy if exists learner_activity_completions_select on public.learner_activity_completions;
create policy learner_activity_completions_select on public.learner_activity_completions
  for select to authenticated
using (profile_id = auth.uid() or btg.is_operator());

grant select on public.learning_modules, public.learning_activities,
  public.learner_module_progress, public.learner_activity_completions to authenticated;
grant insert, update, delete on public.learning_modules, public.learning_activities to authenticated;
grant all on public.learning_modules, public.learning_activities,
  public.learner_module_progress, public.learner_activity_completions to service_role;
