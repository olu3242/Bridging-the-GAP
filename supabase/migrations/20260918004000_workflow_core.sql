-- W14-C — Workflow core.
--
-- Execution state, and only execution state. This migration adds no domain
-- fact and copies none: what is true stays in the E1-E17 tables, what happened
-- stays in the audit ledger, and what follows next lives here.
--
-- Two rules shape every table below.
--
--   1. A published definition version is immutable, and an instance pins the
--      version it started on. A definition change never retroactively alters
--      an in-flight instance.
--   2. A work item cannot be marked completed unless the domain actually
--      shows the corresponding state. The workflow is a projection of the
--      engines, so it is not permitted to assert something the engines do not
--      already say. That is enforced in btg.complete_work_item, not in a
--      comment.
--
-- There is deliberately no dynamic SQL anywhere in this file: a step names a
-- handler and a completion check by label, both foreign-keyed to an allowlist,
-- and the checks themselves are a hardcoded CASE.

-- ------------------------------------------------------------------ enums ---
do $$ begin
  create type public.btg_workflow_scope as enum ('platform','organization');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_workflow_version_status as enum ('draft','published','superseded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_workflow_status as enum
    ('created','active','waiting','completed','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_work_item_type as enum
    ('human','system','ai','approval','external','wait');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_work_item_status as enum
    ('pending','ready','claimed','completed','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_work_owner_kind as enum
    ('system','ai','persona','profile','external');
exception when duplicate_object then null; end $$;

/* Handler classes. All of them are declared now so the type is stable; W14-C
   only implements 'await_domain_state', and a step may not name a handler the
   dispatcher does not yet resolve (asserted in btg.start_workflow). */
do $$ begin
  create type public.btg_workflow_handler as enum
    ('noop','await_domain_state','domain_command','ai_worker',
     'human_review','approval','external_call','timer');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- taxonomy ---
-- The ledger already emits exactly these workflow labels. Reusing them as a
-- foreign-keyed table means a definition cannot invent a label the evidence
-- trail does not recognise, and a test can assert the two agree.
create table if not exists btg.workflow_taxonomy (
  label text primary key check (label ~ '^[a-z0-9_]{3,40}$')
);

insert into btg.workflow_taxonomy (label) values
  ('signup'), ('onboarding'), ('organization_provisioning'),
  ('baseline_diagnostic'), ('pathway_generation'), ('pathway'), ('learning'),
  ('projects'), ('evidence'), ('verification'), ('credentials'),
  ('opportunities'), ('matching'), ('mentorship'), ('tutor'), ('notifications')
on conflict (label) do nothing;

-- ------------------------------------------------------- completion checks ---
-- The allowlist of domain assertions a step may require. `requires_subject_type`
-- is what the work item must reference, so a step cannot be pointed at the
-- wrong kind of entity.
create table if not exists btg.workflow_checks (
  name text primary key check (name ~ '^[a-z0-9_]{3,60}$'),
  requires_subject_type text,
  description text not null
);

insert into btg.workflow_checks (name, requires_subject_type, description) values
  ('diagnostic_attempt_started', 'diagnostic_attempt',
   'A diagnostic attempt exists and belongs to the workflow subject.'),
  ('diagnostic_attempt_scored', 'diagnostic_attempt',
   'The referenced attempt reached status = scored through submit_diagnostic_attempt.'),
  ('learner_baseline_recorded', null,
   'The subject has at least one learner_competencies row with source = baseline.')
on conflict (name) do update set
  requires_subject_type = excluded.requires_subject_type,
  description = excluded.description;

-- ------------------------------------------------------------ definitions ---
create table if not exists public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[A-Za-z0-9_]{3,60}$'),
  name text not null check (char_length(btrim(name)) between 3 and 120),
  description text,
  scope public.btg_workflow_scope not null default 'platform',
  /* The ledger label this workflow's evidence is filed under. Null for a
     coordinator that spans several, which files each step under its own. */
  audit_workflow text references btg.workflow_taxonomy(label),
  /* Configurable: whether the workflow may be instantiated at all. */
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.workflow_definitions is
  'W14-C: what a workflow is. Execution state only -- no domain fact lives here.';

create table if not exists public.workflow_definition_versions (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.workflow_definitions(id) on delete cascade,
  version integer not null check (version >= 1),
  status public.btg_workflow_version_status not null default 'draft',
  notes text,
  published_at timestamptz,
  superseded_at timestamptz,
  superseded_by uuid references public.workflow_definition_versions(id),
  created_at timestamptz not null default now(),
  unique (definition_id, version),
  constraint workflow_version_published_at check
    ((status = 'draft') = (published_at is null)),
  constraint workflow_version_superseded check
    ((status = 'superseded') = (superseded_at is not null))
);
comment on table public.workflow_definition_versions is
  'W14-C: a published version is immutable and is pinned by every instance that started on it.';

-- At most one published version per definition.
create unique index if not exists workflow_versions_one_published
  on public.workflow_definition_versions (definition_id) where status = 'published';

create table if not exists public.workflow_definition_steps (
  id uuid primary key default gen_random_uuid(),
  definition_version_id uuid not null
    references public.workflow_definition_versions(id) on delete cascade,
  step_key text not null check (step_key ~ '^[a-z0-9_]{2,60}$'),
  ordinal smallint not null check (ordinal >= 1),
  item_type public.btg_work_item_type not null,
  handler public.btg_workflow_handler not null,
  /* Named allowlist entries only -- never a function name from a payload. */
  completion_check text references btg.workflow_checks(name),
  /* Set in W14-D; FK added with the command allowlist in that batch. */
  domain_command text,
  owner_kind public.btg_work_owner_kind not null default 'system',
  owner_persona public.btg_persona,
  /* Configurable per step. */
  sla_hours numeric(6,2) check (sla_hours is null or sla_hours > 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  priority smallint not null default 100 check (priority between 1 and 1000),
  /* Which ledger label this step's evidence is filed under, when the parent
     definition spans more than one. */
  audit_workflow text references btg.workflow_taxonomy(label),
  created_at timestamptz not null default now(),
  unique (definition_version_id, step_key),
  unique (definition_version_id, ordinal),
  constraint workflow_step_await_needs_check check
    (handler <> 'await_domain_state' or completion_check is not null),
  constraint workflow_step_persona_owner check
    (owner_kind = 'persona' or owner_persona is null)
);
comment on table public.workflow_definition_steps is
  'W14-C: the step catalog of one definition version. Frozen when the version publishes.';

-- -------------------------------------------------------------- instances ---
create table if not exists public.workflow_instances (
  /* The durable process identity. Deliberately NOT correlation_id, which is
     generated per HTTP request and dies with it. */
  id uuid primary key default gen_random_uuid(),
  definition_version_id uuid not null
    references public.workflow_definition_versions(id),
  status public.btg_workflow_status not null default 'created',
  organization_id uuid references public.organizations(id) on delete set null,
  subject_profile_id uuid references public.profiles(id) on delete cascade,
  /* Namespaced by the caller, e.g. 'baseline_diagnostic:<profile>'. */
  idempotency_key text,
  started_at timestamptz,
  settled_at timestamptz,
  failure text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_instance_settled check
    ((status in ('completed','failed','cancelled')) = (settled_at is not null)),
  constraint workflow_instance_failure check
    (failure is null or status = 'failed')
);
comment on table public.workflow_instances is
  'W14-C: one durable run. Pins its definition version; never copies an engine status.';

create unique index if not exists workflow_instances_idempotent
  on public.workflow_instances (idempotency_key) where idempotency_key is not null;
create index if not exists workflow_instances_subject_idx
  on public.workflow_instances (subject_profile_id, created_at desc);
create index if not exists workflow_instances_open_idx
  on public.workflow_instances (status) where status in ('created','active','waiting');

-- ------------------------------------------------------------- work items ---
create table if not exists public.workflow_work_items (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null
    references public.workflow_instances(id) on delete cascade,
  step_key text not null,
  item_type public.btg_work_item_type not null,
  status public.btg_work_item_status not null default 'pending',
  owner_kind public.btg_work_owner_kind not null default 'system',
  owner_persona public.btg_persona,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  priority smallint not null default 100 check (priority between 1 and 1000),
  available_at timestamptz not null default now(),
  deadline_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  /* Bounded, and a reference rather than a copy: the domain entity this step
     concerns is named by (subject_type, subject_id), never duplicated here. */
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  failure text,
  subject_type text check (subject_type is null or subject_type ~ '^[a-z0-9_]{2,40}$'),
  subject_id uuid,
  idempotency_key text,
  claimed_at timestamptz,
  claimed_by text,
  lease_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_item_input_bounded check (octet_length(input::text) <= 8192),
  constraint work_item_result_bounded check (result is null or octet_length(result::text) <= 8192),
  constraint work_item_subject_pair check ((subject_type is null) = (subject_id is null)),
  constraint work_item_claim_consistency check
    ((status = 'claimed') = (claimed_by is not null and lease_until is not null)),
  constraint work_item_completed_at check ((status = 'completed') = (completed_at is not null)),
  constraint work_item_persona_owner check (owner_kind = 'persona' or owner_persona is null),
  constraint work_item_profile_owner check
    (owner_kind in ('persona','profile') or owner_profile_id is null)
);
comment on table public.workflow_work_items is
  'W14-C: one unit of execution. Completion is verified against domain state, never asserted.';

-- One live item per step per instance; a failed or cancelled one may be replaced.
create unique index if not exists work_items_one_live_per_step
  on public.workflow_work_items (workflow_instance_id, step_key)
  where status not in ('failed','cancelled');
create unique index if not exists work_items_idempotent
  on public.workflow_work_items (idempotency_key) where idempotency_key is not null;
create index if not exists work_items_actionable_idx
  on public.workflow_work_items (status, available_at, priority)
  where status in ('pending','ready');
create index if not exists work_items_owner_idx
  on public.workflow_work_items (owner_profile_id, status) where owner_profile_id is not null;
create index if not exists work_items_deadline_idx
  on public.workflow_work_items (deadline_at) where deadline_at is not null;

-- ------------------------------------------------- transition registration ---
insert into btg.state_transitions (machine, from_state, to_state) values
  ('workflow_version', 'draft', 'published'),
  ('workflow_version', 'published', 'superseded'),

  ('workflow_instance', 'created', 'active'),
  ('workflow_instance', 'created', 'cancelled'),
  ('workflow_instance', 'active', 'waiting'),
  ('workflow_instance', 'active', 'completed'),
  ('workflow_instance', 'active', 'failed'),
  ('workflow_instance', 'active', 'cancelled'),
  ('workflow_instance', 'waiting', 'active'),
  ('workflow_instance', 'waiting', 'completed'),
  ('workflow_instance', 'waiting', 'failed'),
  ('workflow_instance', 'waiting', 'cancelled'),

  ('work_item', 'pending', 'ready'),
  ('work_item', 'pending', 'cancelled'),
  ('work_item', 'ready', 'claimed'),
  ('work_item', 'ready', 'completed'),
  ('work_item', 'ready', 'failed'),
  ('work_item', 'ready', 'cancelled'),
  ('work_item', 'claimed', 'completed'),
  ('work_item', 'claimed', 'failed'),
  ('work_item', 'claimed', 'ready'),
  ('work_item', 'claimed', 'cancelled'),
  ('work_item', 'failed', 'ready')
on conflict do nothing;

drop trigger if exists workflow_versions_enforce_transition on public.workflow_definition_versions;
create trigger workflow_versions_enforce_transition
  before update on public.workflow_definition_versions
  for each row when (old.status is distinct from new.status)
  execute function btg.enforce_transition('workflow_version', 'status');

drop trigger if exists workflow_instances_enforce_transition on public.workflow_instances;
create trigger workflow_instances_enforce_transition
  before update on public.workflow_instances
  for each row when (old.status is distinct from new.status)
  execute function btg.enforce_transition('workflow_instance', 'status');

drop trigger if exists work_items_enforce_transition on public.workflow_work_items;
create trigger work_items_enforce_transition
  before update on public.workflow_work_items
  for each row when (old.status is distinct from new.status)
  execute function btg.enforce_transition('work_item', 'status');

drop trigger if exists workflow_instances_touch on public.workflow_instances;
create trigger workflow_instances_touch before update on public.workflow_instances
  for each row execute function btg.touch_updated_at();
drop trigger if exists work_items_touch on public.workflow_work_items;
create trigger work_items_touch before update on public.workflow_work_items
  for each row execute function btg.touch_updated_at();
drop trigger if exists workflow_definitions_touch on public.workflow_definitions;
create trigger workflow_definitions_touch before update on public.workflow_definitions
  for each row execute function btg.touch_updated_at();

-- ------------------------------------------------------ version immutability ---
/* A published version may only be superseded. Nothing else about it changes,
   ever, because instances are still running against it. */
create or replace function btg.guard_definition_version()
returns trigger language plpgsql set search_path = public, btg, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'a % definition version is permanent', old.status
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.status = 'superseded' then
    raise exception 'a superseded definition version is immutable' using errcode = '42501';
  end if;

  if old.status = 'published' then
    if new.definition_id is distinct from old.definition_id
       or new.version is distinct from old.version
       or new.notes is distinct from old.notes
       or new.published_at is distinct from old.published_at then
      raise exception 'a published definition version is immutable' using errcode = '42501';
    end if;
    if new.status not in ('published','superseded') then
      raise exception 'a published version may only be superseded' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists workflow_versions_immutable on public.workflow_definition_versions;
create trigger workflow_versions_immutable
  before update or delete on public.workflow_definition_versions
  for each row execute function btg.guard_definition_version();

/* Versions are monotonic: a new one is exactly max + 1 for its definition. */
create or replace function btg.assign_definition_version()
returns trigger language plpgsql set search_path = public, btg, pg_temp as $$
declare v_next integer;
begin
  select coalesce(max(version), 0) + 1 into v_next
  from public.workflow_definition_versions where definition_id = new.definition_id;
  if new.version is null or new.version = 0 then
    new.version := v_next;
  elsif new.version <> v_next then
    raise exception 'definition versions are monotonic: expected %, got %', v_next, new.version
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_versions_monotonic on public.workflow_definition_versions;
create trigger workflow_versions_monotonic
  before insert on public.workflow_definition_versions
  for each row execute function btg.assign_definition_version();

/* The step catalog freezes with its version. */
create or replace function btg.guard_definition_steps()
returns trigger language plpgsql set search_path = public, btg, pg_temp as $$
declare v_status public.btg_workflow_version_status; v_version uuid;
begin
  if tg_op = 'DELETE' then
    v_version := old.definition_version_id;
  else
    v_version := new.definition_version_id;
  end if;

  select status into v_status from public.workflow_definition_versions where id = v_version;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'the step catalog of a % version cannot change', v_status
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists workflow_steps_frozen on public.workflow_definition_steps;
create trigger workflow_steps_frozen
  before insert or update or delete on public.workflow_definition_steps
  for each row execute function btg.guard_definition_steps();

/* An instance never migrates version silently. Moving one is an explicit,
   recorded operation and is not implemented here -- so it is refused. */
create or replace function btg.guard_instance_version_pin()
returns trigger language plpgsql set search_path = public, btg, pg_temp as $$
begin
  if new.definition_version_id is distinct from old.definition_version_id then
    raise exception 'an instance pins its definition version' using errcode = '42501';
  end if;
  if new.subject_profile_id is distinct from old.subject_profile_id then
    raise exception 'an instance cannot change subject' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_instances_pinned on public.workflow_instances;
create trigger workflow_instances_pinned
  before update on public.workflow_instances
  for each row execute function btg.guard_instance_version_pin();

-- ---------------------------------------------------------------- read ACL ---
/* Answered outside RLS so the work-item policy can reference the instance
   without the policy on one table reading a table whose policy reads it back
   -- the recursion that defect 14 was. */
create or replace function btg.can_read_instance(p_instance uuid)
returns boolean language sql stable security definer
set search_path = public, btg, pg_temp as $$
  select exists (
    select 1 from public.workflow_instances i
    where i.id = p_instance
      and (i.subject_profile_id = auth.uid()
           or btg.is_operator()
           or (i.organization_id is not null
               and i.organization_id in (select btg.governed_org_ids())))
  );
$$;

alter table public.workflow_definitions enable row level security;
alter table public.workflow_definition_versions enable row level security;
alter table public.workflow_definition_steps enable row level security;
alter table public.workflow_instances enable row level security;
alter table public.workflow_work_items enable row level security;

-- Definitions, versions and steps are operator configuration.
drop policy if exists workflow_definitions_select on public.workflow_definitions;
create policy workflow_definitions_select on public.workflow_definitions
  for select to authenticated using (btg.is_operator());

drop policy if exists workflow_versions_select on public.workflow_definition_versions;
create policy workflow_versions_select on public.workflow_definition_versions
  for select to authenticated using (btg.is_operator());

drop policy if exists workflow_steps_select on public.workflow_definition_steps;
create policy workflow_steps_select on public.workflow_definition_steps
  for select to authenticated using (btg.is_operator());

-- An instance is visible to its subject, an operator, and an admin of the
-- organization it runs for. Nobody else.
drop policy if exists workflow_instances_select on public.workflow_instances;
create policy workflow_instances_select on public.workflow_instances
  for select to authenticated using (
    subject_profile_id = auth.uid()
    or btg.is_operator()
    or (organization_id is not null
        and organization_id in (select btg.governed_org_ids()))
  );

drop policy if exists work_items_select on public.workflow_work_items;
create policy work_items_select on public.workflow_work_items
  for select to authenticated using (
    owner_profile_id = auth.uid() or btg.can_read_instance(workflow_instance_id)
  );

-- Read only. There is no session write path to execution state at all: every
-- mutation goes through a service_role function below.
grant select on public.workflow_definitions, public.workflow_definition_versions,
  public.workflow_definition_steps, public.workflow_instances,
  public.workflow_work_items to authenticated;
grant all on public.workflow_definitions, public.workflow_definition_versions,
  public.workflow_definition_steps, public.workflow_instances,
  public.workflow_work_items to service_role;
grant select, insert, update, delete on btg.workflow_taxonomy, btg.workflow_checks
  to service_role;

-- ------------------------------------------------------- domain assertions ---
/* The allowlisted completion checks. No dynamic SQL: a step names one of
   these labels, the label is foreign-keyed, and the body is a CASE. Adding a
   check is a migration, which is the point. */
create or replace function btg.assert_step_satisfied(
  p_check text,
  p_subject_type text,
  p_subject_id uuid,
  p_profile uuid
)
returns boolean language plpgsql stable security definer
set search_path = public, btg, pg_temp as $$
declare
  v_required text;
  v_ok boolean := false;
begin
  select requires_subject_type into v_required from btg.workflow_checks where name = p_check;
  if not found then
    raise exception 'unknown completion check %', p_check using errcode = '42501';
  end if;
  if v_required is not null and coalesce(p_subject_type, '') <> v_required then
    raise exception 'check % needs a % subject, got %',
      p_check, v_required, coalesce(p_subject_type, 'none')
      using errcode = 'check_violation';
  end if;

  case p_check
    when 'diagnostic_attempt_started' then
      select exists (
        select 1 from public.diagnostic_attempts a
        where a.id = p_subject_id and a.profile_id = p_profile) into v_ok;
    when 'diagnostic_attempt_scored' then
      select exists (
        select 1 from public.diagnostic_attempts a
        where a.id = p_subject_id and a.profile_id = p_profile
          and a.status = 'scored') into v_ok;
    when 'learner_baseline_recorded' then
      select exists (
        select 1 from public.learner_competencies lc
        where lc.profile_id = p_profile and lc.source = 'baseline') into v_ok;
    else
      raise exception 'completion check % is registered but not implemented', p_check
        using errcode = '42501';
  end case;

  return v_ok;
end;
$$;

-- ------------------------------------------------------------- evidence ---
/* The runtime's own evidence writer. public.record_audit_event requires an
   authenticated actor -- correctly, since it is the session-facing path -- and
   a worker has no session. This records the same shape with a null actor and
   an explicit system marker, so a runtime action is never attributed to a
   learner who did not take it. service_role only. */
create or replace function btg.record_workflow_event(
  p_action text,
  p_object_type text,
  p_object_id text,
  p_organization_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_severity public.btg_audit_severity default 'info',
  p_workflow text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_id uuid;
begin
  insert into public.audit_events (
    actor_profile_id, actor_persona, organization_id, action, object_type, object_id,
    before, after, severity, workflow, metadata
  ) values (
    null, null, p_organization_id, p_action, p_object_type, p_object_id,
    p_before, p_after, p_severity, p_workflow,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('actor', 'workflow_runtime')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------- publishing ---
create or replace function btg.publish_definition_version(p_version_id uuid)
returns public.workflow_definition_versions
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_version public.workflow_definition_versions;
  v_current public.workflow_definition_versions;
  v_steps integer;
begin
  select * into v_version from public.workflow_definition_versions
  where id = p_version_id for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if v_version.status <> 'draft' then
    raise exception 'only a draft may be published' using errcode = 'check_violation';
  end if;

  select count(*) into v_steps from public.workflow_definition_steps
  where definition_version_id = p_version_id;
  if v_steps = 0 then
    raise exception 'a version with no steps would complete on creation'
      using errcode = 'check_violation';
  end if;

  -- Ordinals must be 1..n with no gap, or "the next step" is ambiguous.
  if exists (
    select 1 from (
      select ordinal, row_number() over (order by ordinal) as rn
      from public.workflow_definition_steps where definition_version_id = p_version_id
    ) s where s.ordinal <> s.rn
  ) then
    raise exception 'step ordinals must be 1..n with no gaps' using errcode = 'check_violation';
  end if;

  select * into v_current from public.workflow_definition_versions
  where definition_id = v_version.definition_id and status = 'published' for update;

  -- Supersede first: the one-published-version index would otherwise see two.
  if v_current.id is not null then
    update public.workflow_definition_versions
    set status = 'superseded', superseded_at = now(), superseded_by = p_version_id
    where id = v_current.id;
  end if;

  update public.workflow_definition_versions
  set status = 'published', published_at = now()
  where id = p_version_id
  returning * into v_version;

  perform btg.record_workflow_event(
    'workflow.definition.published', 'workflow_definition_version', p_version_id::text,
    null, case when v_current.id is null then null
               else jsonb_build_object('superseded_version', v_current.version) end,
    jsonb_build_object('version', v_version.version, 'steps', v_steps),
    'notice'::public.btg_audit_severity, null);

  return v_version;
end;
$$;

-- --------------------------------------------------------------- start run ---
create or replace function btg.start_workflow(
  p_definition_key text,
  p_subject_profile_id uuid,
  p_organization_id uuid default null,
  p_idempotency_key text default null
)
returns public.workflow_instances
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_def public.workflow_definitions;
  v_version public.workflow_definition_versions;
  v_instance public.workflow_instances;
  v_step record;
  v_existing uuid;
begin
  select * into v_def from public.workflow_definitions where key = p_definition_key;
  if not found then
    raise exception 'workflow % is not defined', p_definition_key using errcode = 'P0002';
  end if;
  if not v_def.is_enabled then
    raise exception 'workflow % is not enabled', p_definition_key using errcode = 'check_violation';
  end if;
  if v_def.scope = 'organization' and p_organization_id is null then
    raise exception 'workflow % is organization-scoped', p_definition_key
      using errcode = 'check_violation';
  end if;

  select * into v_version from public.workflow_definition_versions
  where definition_id = v_def.id and status = 'published';
  if not found then
    raise exception 'workflow % has no published version', p_definition_key
      using errcode = 'check_violation';
  end if;

  -- A handler the dispatcher cannot resolve would strand the instance.
  if exists (
    select 1 from public.workflow_definition_steps s
    where s.definition_version_id = v_version.id
      and s.handler <> 'await_domain_state'
  ) then
    raise exception 'version % uses a handler no dispatcher resolves yet', v_version.version
      using errcode = 'feature_not_supported';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.workflow_instances
    where idempotency_key = p_idempotency_key;
    if found then
      select * into v_instance from public.workflow_instances where id = v_existing;
      return v_instance;
    end if;
  end if;

  insert into public.workflow_instances (
    definition_version_id, organization_id, subject_profile_id, idempotency_key
  ) values (
    v_version.id, p_organization_id, p_subject_profile_id, p_idempotency_key
  )
  returning * into v_instance;

  for v_step in
    select * from public.workflow_definition_steps
    where definition_version_id = v_version.id order by ordinal
  loop
    insert into public.workflow_work_items (
      workflow_instance_id, step_key, item_type, owner_kind, owner_persona,
      priority, max_attempts, deadline_at, idempotency_key
    ) values (
      v_instance.id, v_step.step_key, v_step.item_type, v_step.owner_kind,
      v_step.owner_persona, v_step.priority, v_step.max_attempts,
      case when v_step.sla_hours is null then null
           else now() + make_interval(hours => floor(v_step.sla_hours)::int,
                                      mins => round((v_step.sla_hours - floor(v_step.sla_hours)) * 60)::int)
      end,
      v_instance.id::text || ':' || v_step.step_key
    );
  end loop;

  update public.workflow_instances
  set status = 'active', started_at = now()
  where id = v_instance.id
  returning * into v_instance;

  perform btg.record_workflow_event(
    'workflow.instance.started', 'workflow_instance', v_instance.id::text,
    p_organization_id, null,
    jsonb_build_object('definition', v_def.key, 'version', v_version.version,
                       'subject', p_subject_profile_id),
    'info'::public.btg_audit_severity,
    coalesce(v_def.audit_workflow, null));

  perform btg.advance_instance(v_instance.id);

  select * into v_instance from public.workflow_instances where id = v_instance.id;
  return v_instance;
end;
$$;

-- ----------------------------------------------------------------- advance ---
/* Sequential advancement over the pinned version's ordinals. The instance's
   status follows what the next item needs: a human, approval, external or
   timer step means waiting; system and ai work means active. */
create or replace function btg.advance_instance(p_instance_id uuid)
returns public.workflow_instances
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_instance public.workflow_instances;
  v_open integer;
  v_inflight integer;
  v_next record;
  v_target public.btg_workflow_status;
begin
  select * into v_instance from public.workflow_instances where id = p_instance_id for update;
  if not found then raise exception 'instance not found' using errcode = 'P0002'; end if;
  if v_instance.status in ('completed','failed','cancelled') then return v_instance; end if;

  select count(*) into v_open from public.workflow_work_items
  where workflow_instance_id = p_instance_id and status not in ('completed','cancelled');

  if v_open = 0 then
    update public.workflow_instances
    set status = 'completed', settled_at = now()
    where id = p_instance_id returning * into v_instance;

    perform btg.record_workflow_event(
      'workflow.instance.completed', 'workflow_instance', p_instance_id::text,
      v_instance.organization_id, jsonb_build_object('status', 'active'),
      jsonb_build_object('status', 'completed'),
      'notice'::public.btg_audit_severity,
      (select d.audit_workflow from public.workflow_definitions d
       join public.workflow_definition_versions v on v.definition_id = d.id
       where v.id = v_instance.definition_version_id));
    return v_instance;
  end if;

  select count(*) into v_inflight from public.workflow_work_items
  where workflow_instance_id = p_instance_id and status in ('ready','claimed');

  if v_inflight = 0 then
    select w.id, w.item_type into v_next
    from public.workflow_work_items w
    join public.workflow_definition_steps s
      on s.definition_version_id = v_instance.definition_version_id
     and s.step_key = w.step_key
    where w.workflow_instance_id = p_instance_id and w.status = 'pending'
    order by s.ordinal limit 1;

    if v_next.id is not null then
      update public.workflow_work_items set status = 'ready' where id = v_next.id;
    end if;
  end if;

  select case when exists (
      select 1 from public.workflow_work_items w
      where w.workflow_instance_id = p_instance_id
        and w.status in ('ready','claimed')
        and w.item_type in ('human','approval','external','wait'))
    then 'waiting' else 'active' end::public.btg_workflow_status
  into v_target;

  if v_instance.status is distinct from v_target then
    update public.workflow_instances set status = v_target
    where id = p_instance_id returning * into v_instance;
  end if;

  return v_instance;
end;
$$;

-- ---------------------------------------------------------- bind + complete ---
/* The domain entity a step concerns, attached as a reference. */
create or replace function btg.bind_work_item_subject(
  p_item_id uuid, p_subject_type text, p_subject_id uuid
)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_item public.workflow_work_items;
begin
  update public.workflow_work_items
  set subject_type = p_subject_type, subject_id = p_subject_id
  where id = p_item_id and status in ('pending','ready','claimed')
  returning * into v_item;
  if not found then
    raise exception 'work item not found or already settled' using errcode = 'P0002';
  end if;
  return v_item;
end;
$$;

/* The projection guarantee. A work item reaches 'completed' only if the
   engines already show the state its step requires -- so the workflow can
   never claim a learner did something the domain does not record. */
create or replace function btg.complete_work_item(
  p_item_id uuid, p_result jsonb default '{}'::jsonb
)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_item public.workflow_work_items;
  v_instance public.workflow_instances;
  v_step public.workflow_definition_steps;
  v_satisfied boolean;
begin
  select * into v_item from public.workflow_work_items where id = p_item_id for update;
  if not found then raise exception 'work item not found' using errcode = 'P0002'; end if;
  if v_item.status = 'completed' then return v_item; end if;  -- idempotent
  if v_item.status not in ('ready','claimed') then
    raise exception 'a % work item cannot be completed', v_item.status
      using errcode = 'check_violation';
  end if;

  select * into v_instance from public.workflow_instances
  where id = v_item.workflow_instance_id;

  select * into v_step from public.workflow_definition_steps
  where definition_version_id = v_instance.definition_version_id
    and step_key = v_item.step_key;
  if not found then
    raise exception 'step % is not in the pinned version', v_item.step_key
      using errcode = 'P0002';
  end if;

  if v_step.completion_check is not null then
    v_satisfied := btg.assert_step_satisfied(
      v_step.completion_check, v_item.subject_type, v_item.subject_id,
      v_instance.subject_profile_id);
    if not v_satisfied then
      raise exception 'the domain does not show % for this subject', v_step.completion_check
        using errcode = 'check_violation';
    end if;
  end if;

  update public.workflow_work_items
  set status = 'completed', completed_at = now(), result = p_result,
      claimed_by = null, lease_until = null, failure = null
  where id = p_item_id
  returning * into v_item;

  perform btg.record_workflow_event(
    'workflow.work_item.completed', 'workflow_work_item', p_item_id::text,
    v_instance.organization_id, jsonb_build_object('status', 'ready'),
    jsonb_build_object('status', 'completed', 'step', v_item.step_key,
                       'check', v_step.completion_check,
                       'subject_type', v_item.subject_type,
                       'subject_id', v_item.subject_id),
    'info'::public.btg_audit_severity,
    coalesce(v_step.audit_workflow,
             (select d.audit_workflow from public.workflow_definitions d
              where d.id = (select definition_id from public.workflow_definition_versions
                            where id = v_instance.definition_version_id))));

  perform btg.advance_instance(v_item.workflow_instance_id);

  select * into v_item from public.workflow_work_items where id = p_item_id;
  return v_item;
end;
$$;

create or replace function btg.fail_work_item(p_item_id uuid, p_error text)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_item public.workflow_work_items;
  v_instance public.workflow_instances;
begin
  select * into v_item from public.workflow_work_items where id = p_item_id for update;
  if not found then raise exception 'work item not found' using errcode = 'P0002'; end if;
  if v_item.status not in ('ready','claimed') then
    raise exception 'a % work item cannot fail', v_item.status using errcode = 'check_violation';
  end if;

  select * into v_instance from public.workflow_instances
  where id = v_item.workflow_instance_id;

  if v_item.attempts + 1 >= v_item.max_attempts then
    update public.workflow_work_items
    set status = 'failed', attempts = attempts + 1, failure = p_error,
        claimed_by = null, lease_until = null
    where id = p_item_id returning * into v_item;

    update public.workflow_instances
    set status = 'failed', settled_at = now(),
        failure = 'step ' || v_item.step_key || ': ' || p_error
    where id = v_item.workflow_instance_id and status in ('active','waiting');

    perform btg.record_workflow_event(
      'workflow.instance.failed', 'workflow_instance', v_item.workflow_instance_id::text,
      v_instance.organization_id, null,
      jsonb_build_object('step', v_item.step_key, 'error', p_error,
                         'attempts', v_item.attempts),
      'critical'::public.btg_audit_severity, null);
  else
    update public.workflow_work_items
    set status = 'ready', attempts = attempts + 1, failure = p_error,
        claimed_by = null, lease_until = null,
        available_at = now() + make_interval(secs => least(3600, (5 * power(2, attempts))::int))
    where id = p_item_id returning * into v_item;
  end if;

  return v_item;
end;
$$;

create or replace function btg.cancel_workflow(p_instance_id uuid, p_reason text)
returns public.workflow_instances
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_instance public.workflow_instances;
begin
  select * into v_instance from public.workflow_instances where id = p_instance_id for update;
  if not found then raise exception 'instance not found' using errcode = 'P0002'; end if;
  if v_instance.status in ('completed','failed','cancelled') then return v_instance; end if;

  update public.workflow_work_items set status = 'cancelled', claimed_by = null, lease_until = null
  where workflow_instance_id = p_instance_id and status in ('pending','ready','claimed');

  update public.workflow_instances set status = 'cancelled', settled_at = now()
  where id = p_instance_id returning * into v_instance;

  perform btg.record_workflow_event(
    'workflow.instance.cancelled', 'workflow_instance', p_instance_id::text,
    v_instance.organization_id, null, jsonb_build_object('reason', p_reason),
    'notice'::public.btg_audit_severity, null);

  return v_instance;
end;
$$;

-- -------------------------------------------------------- function grants ---
/* Every runtime function is service_role only, revoked from PUBLIC explicitly
   rather than left to a default privilege -- the two security defects this
   branch already fixed were both default-privilege failures. btg.can_read_instance
   is the exception: RLS must evaluate it as the calling role. */
do $$ declare fn text;
begin
  foreach fn in array array[
    'btg.assert_step_satisfied(text, text, uuid, uuid)',
    'btg.record_workflow_event(text, text, text, uuid, jsonb, jsonb, public.btg_audit_severity, text, jsonb)',
    'btg.publish_definition_version(uuid)',
    'btg.start_workflow(text, uuid, uuid, text)',
    'btg.advance_instance(uuid)',
    'btg.bind_work_item_subject(uuid, text, uuid)',
    'btg.complete_work_item(uuid, jsonb)',
    'btg.fail_work_item(uuid, text)',
    'btg.cancel_workflow(uuid, text)',
    'btg.guard_definition_version()',
    'btg.assign_definition_version()',
    'btg.guard_definition_steps()',
    'btg.guard_instance_version_pin()'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

revoke all on function btg.can_read_instance(uuid) from public;
revoke all on function btg.can_read_instance(uuid) from anon;
grant execute on function btg.can_read_instance(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ seeds ---
/* Every workflow label the ledger emits is reserved as a definition, plus the
   coordinator. Only baseline_diagnostic is enabled and versioned in W14-C:
   a definition with no published version cannot be instantiated, which is
   exactly the right default for the ones whose batches have not landed. */
insert into public.workflow_definitions (key, name, description, scope, audit_workflow, is_enabled)
values
  ('signup', 'Sign-up', 'Account creation through to a usable profile.', 'platform', 'signup', false),
  ('onboarding', 'Onboarding', 'Persona, profile and goal capture.', 'platform', 'onboarding', false),
  ('organization_provisioning', 'Organization provisioning',
   'Creating an organization and its first admin membership.', 'organization',
   'organization_provisioning', false),
  ('baseline_diagnostic', 'Baseline diagnostic',
   'Measuring a learner''s starting competency levels.', 'platform', 'baseline_diagnostic', true),
  ('pathway_generation', 'Pathway generation',
   'Deriving a pathway from a measured baseline.', 'platform', 'pathway_generation', false),
  ('pathway', 'Pathway progress', 'Working through pathway steps.', 'platform', 'pathway', false),
  ('learning', 'Learning', 'Module and activity completion.', 'platform', 'learning', false),
  ('projects', 'Projects', 'Assigned project work.', 'platform', 'projects', false),
  ('evidence', 'Evidence', 'Evidence submission.', 'platform', 'evidence', false),
  ('verification', 'Verification', 'Human review of submitted evidence.', 'platform', 'verification', false),
  ('credentials', 'Credentials', 'Credential issuance from verified skills.', 'platform', 'credentials', false),
  ('opportunities', 'Opportunities', 'Application pipeline.', 'platform', 'opportunities', false),
  ('matching', 'Matching', 'Computing opportunity matches.', 'platform', 'matching', false),
  ('mentorship', 'Mentorship', 'Mentor matching and engagement.', 'platform', 'mentorship', false),
  ('tutor', 'Tutor', 'Governed AI tutoring turns.', 'platform', 'tutor', false),
  ('notifications', 'Notifications', 'Notification dispatch.', 'platform', 'notifications', false),
  ('BTG_LEARNER_TO_OPPORTUNITY', 'Learner to opportunity',
   'The coordinator spanning sign-up through to an accepted offer. Reserved; invokes the engine workflows rather than reimplementing them.',
   'platform', null, false)
on conflict (key) do update set
  name = excluded.name, description = excluded.description,
  scope = excluded.scope, audit_workflow = excluded.audit_workflow;

/* baseline_diagnostic v1. Three steps, each an assertion about domain state
   the diagnostic engine owns: the attempt exists, the attempt was scored by
   submit_diagnostic_attempt, and the baseline landed in learner_competencies.
   The engine remains authoritative throughout -- this catalog describes what
   the workflow waits for, not how any of it happens. */
do $$
declare v_def uuid; v_version uuid;
begin
  select id into v_def from public.workflow_definitions where key = 'baseline_diagnostic';

  if exists (select 1 from public.workflow_definition_versions
             where definition_id = v_def and status = 'published') then
    return;
  end if;

  insert into public.workflow_definition_versions (definition_id, notes)
  values (v_def, 'W14-C: first published version. Awaits the diagnostic engine.')
  returning id into v_version;

  insert into public.workflow_definition_steps (
    definition_version_id, step_key, ordinal, item_type, handler,
    completion_check, owner_kind, sla_hours, audit_workflow
  ) values
    (v_version, 'attempt_started', 1, 'system', 'await_domain_state',
     'diagnostic_attempt_started', 'system', null, 'baseline_diagnostic'),
    (v_version, 'attempt_scored', 2, 'system', 'await_domain_state',
     'diagnostic_attempt_scored', 'system', 72, 'baseline_diagnostic'),
    (v_version, 'baseline_recorded', 3, 'system', 'await_domain_state',
     'learner_baseline_recorded', 'system', null, 'baseline_diagnostic');

  perform btg.publish_definition_version(v_version);
end $$;
