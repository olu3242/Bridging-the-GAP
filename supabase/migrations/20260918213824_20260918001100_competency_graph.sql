-- W02 Batch A — E4 Competency Graph Engine.
-- The skill taxonomy every later wave measures against: domains, competencies,
-- proficiency levels, prerequisites and evidence requirements.

create table if not exists public.competency_domains (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text check (description is null or char_length(description) <= 600),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.competency_domains is 'E4: top-level grouping of competencies.';

create table if not exists public.competencies (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.competency_domains(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])$'),
  name text not null check (char_length(btrim(name)) between 2 and 140),
  description text check (description is null or char_length(description) <= 800),
  -- Levels run 1..5. target_level is the level treated as opportunity-ready.
  target_level smallint not null default 3 check (target_level between 1 and 5),
  -- What a learner must produce for this competency to become verified (W06).
  evidence_requirement text check (evidence_requirement is null or char_length(evidence_requirement) <= 600),
  is_technical boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.competencies is 'E4: a single measurable capability, scored 1..5.';

create index if not exists competencies_domain_idx on public.competencies (domain_id, sort_order);

create table if not exists public.competency_levels (
  competency_id uuid not null references public.competencies(id) on delete cascade,
  level smallint not null check (level between 1 and 5),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  descriptor text not null check (char_length(btrim(descriptor)) between 4 and 600),
  primary key (competency_id, level)
);
comment on table public.competency_levels is 'E4: what each level means for a competency. Drives gap explanations.';

create table if not exists public.competency_prerequisites (
  competency_id uuid not null references public.competencies(id) on delete cascade,
  prerequisite_id uuid not null references public.competencies(id) on delete cascade,
  minimum_level smallint not null default 2 check (minimum_level between 1 and 5),
  primary key (competency_id, prerequisite_id),
  constraint competency_prerequisites_not_self check (competency_id <> prerequisite_id)
);
comment on table public.competency_prerequisites is 'E4: prerequisite edges. Kept acyclic by trigger.';

create index if not exists competency_prerequisites_prereq_idx
  on public.competency_prerequisites (prerequisite_id);

-- The graph must stay a DAG: a cycle would make pathway generation (W03)
-- non-terminating.
create or replace function btg.assert_no_prerequisite_cycle()
returns trigger language plpgsql as $$
begin
  if exists (
    with recursive walk(id) as (
      select new.prerequisite_id
      union
      select p.prerequisite_id
      from public.competency_prerequisites p
      join walk w on p.competency_id = w.id
    )
    select 1 from walk where id = new.competency_id
  ) then
    raise exception 'prerequisite cycle: % cannot require %', new.competency_id, new.prerequisite_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists competency_prerequisites_acyclic on public.competency_prerequisites;
create trigger competency_prerequisites_acyclic
  before insert or update on public.competency_prerequisites
  for each row execute function btg.assert_no_prerequisite_cycle();

drop trigger if exists competencies_touch_updated_at on public.competencies;
create trigger competencies_touch_updated_at before update on public.competencies
  for each row execute function btg.touch_updated_at();

-- ------------------------------------------------------------------- RLS ---
-- The taxonomy is a read-only catalogue for every signed-in actor and is
-- governed by operators only.
alter table public.competency_domains enable row level security;
alter table public.competencies enable row level security;
alter table public.competency_levels enable row level security;
alter table public.competency_prerequisites enable row level security;

do $$
declare t text;
begin
  foreach t in array array['competency_domains','competencies','competency_levels','competency_prerequisites'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated
                      using (btg.is_operator()) with check (btg.is_operator())', t, t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
