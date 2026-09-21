-- E5 Pathway Engine. Consumes learner_competency_gaps + the prerequisite
-- graph; produces a versioned, ordered, explainable plan. Regeneration
-- supersedes rather than overwrites.

do $$ begin
  create type public.btg_pathway_status as enum ('draft','active','superseded','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_step_status as enum ('locked','available','in_progress','completed','skipped');
exception when duplicate_object then null; end $$;

create table if not exists public.pathways (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  version smallint not null check (version >= 1),
  status public.btg_pathway_status not null default 'draft',
  generated_from_attempt_id uuid references public.diagnostic_attempts(id) on delete set null,
  /* Why this plan looks like this: inputs, ordering rule, counts. */
  rationale jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  superseded_by uuid references public.pathways(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, version),
  -- activated_at records when this plan went live and survives supersession,
  -- so the rule is an implication rather than an equivalence.
  constraint pathways_active_consistency check (status <> 'active' or activated_at is not null),
  constraint pathways_superseded_consistency check ((status = 'superseded') = (superseded_at is not null))
);
comment on table public.pathways is 'E5: one versioned plan per learner. Only one may be active.';

create unique index if not exists pathways_one_active
  on public.pathways (profile_id) where status = 'active';

create table if not exists public.pathway_steps (
  id uuid primary key default gen_random_uuid(),
  pathway_id uuid not null references public.pathways(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  position smallint not null check (position >= 1),
  from_level smallint not null check (from_level between 0 and 5),
  target_level smallint not null check (target_level between 1 and 5),
  status public.btg_step_status not null default 'locked',
  /* Learner-facing explanation, generated deterministically. */
  rationale text not null,
  /* Topological depth in the prerequisite graph — the ordering key. */
  depth smallint not null default 0,
  unlocked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pathway_id, competency_id),
  unique (pathway_id, position),
  constraint pathway_steps_target_above_from check (target_level > from_level),
  constraint pathway_steps_completed_consistency check ((status = 'completed') = (completed_at is not null))
);
comment on table public.pathway_steps is 'E5: one competency to move, in prerequisite-safe order.';

create index if not exists pathway_steps_pathway_idx on public.pathway_steps (pathway_id, position);
create index if not exists pathway_steps_open_idx
  on public.pathway_steps (pathway_id) where status in ('available','in_progress');

create table if not exists public.pathway_step_dependencies (
  step_id uuid not null references public.pathway_steps(id) on delete cascade,
  depends_on_step_id uuid not null references public.pathway_steps(id) on delete cascade,
  primary key (step_id, depends_on_step_id),
  constraint pathway_step_dependencies_not_self check (step_id <> depends_on_step_id)
);
comment on table public.pathway_step_dependencies is
  'E5: prerequisite edges projected onto this pathway. Governs unlocking.';

do $$ declare t text;
begin
  foreach t in array array['pathways','pathway_steps'] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format('create trigger %I_touch_updated_at before update on public.%I
                      for each row execute function btg.touch_updated_at()', t, t);
  end loop;
end $$;

insert into btg.state_transitions (machine, from_state, to_state) values
  ('pathway','draft','active'),
  ('pathway','draft','archived'),
  ('pathway','active','superseded'),
  ('pathway','active','archived'),
  ('pathway_step','locked','available'),
  ('pathway_step','available','in_progress'),
  ('pathway_step','available','skipped'),
  ('pathway_step','in_progress','completed'),
  ('pathway_step','in_progress','available'),
  ('pathway_step','completed','in_progress')
on conflict do nothing;

drop trigger if exists pathways_enforce_transition on public.pathways;
create trigger pathways_enforce_transition before update of status on public.pathways
  for each row execute function btg.enforce_transition('pathway', 'status');

drop trigger if exists pathway_steps_enforce_transition on public.pathway_steps;
create trigger pathway_steps_enforce_transition before update of status on public.pathway_steps
  for each row execute function btg.enforce_transition('pathway_step', 'status');

alter table public.profiles add column if not exists active_pathway_id uuid
  references public.pathways(id) on delete set null;

alter table public.pathways enable row level security;
alter table public.pathway_steps enable row level security;
alter table public.pathway_step_dependencies enable row level security;

drop policy if exists pathways_select on public.pathways;
create policy pathways_select on public.pathways for select to authenticated
using (
  profile_id = auth.uid() or btg.is_operator()
  or exists (
    select 1 from public.memberships m
    where m.profile_id = pathways.profile_id and m.status = 'active'
      and m.organization_id in (select btg.governed_org_ids())
  )
);

drop policy if exists pathway_steps_select on public.pathway_steps;
create policy pathway_steps_select on public.pathway_steps for select to authenticated
using (exists (select 1 from public.pathways p where p.id = pathway_steps.pathway_id));

drop policy if exists pathway_step_dependencies_select on public.pathway_step_dependencies;
create policy pathway_step_dependencies_select on public.pathway_step_dependencies
  for select to authenticated
using (exists (select 1 from public.pathway_steps s where s.id = pathway_step_dependencies.step_id));

-- Writes go through the commands only.
grant select on public.pathways, public.pathway_steps, public.pathway_step_dependencies
  to authenticated;
grant all on public.pathways, public.pathway_steps, public.pathway_step_dependencies
  to service_role;
