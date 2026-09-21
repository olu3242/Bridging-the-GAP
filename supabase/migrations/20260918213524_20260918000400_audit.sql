-- W01 Batch A — E16 Governance: append-only audit ledger.

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  -- clock_timestamp(), not now(): several events raised inside one transaction
  -- must still be orderable against each other.
  occurred_at timestamptz not null default clock_timestamp(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_persona public.btg_persona,
  organization_id uuid references public.organizations(id) on delete set null,
  action text not null check (action ~ '^[a-z0-9_]+\.[a-z0-9_.]+$'),
  object_type text not null check (char_length(object_type) between 2 and 64),
  object_id text,
  before jsonb,
  after jsonb,
  severity public.btg_audit_severity not null default 'info',
  correlation_id uuid,
  workflow text,
  policy_version text,
  metadata jsonb not null default '{}'::jsonb
);
comment on table public.audit_events is 'E16: immutable audit ledger. Insert-only, via btg.record_audit_event.';

create index if not exists audit_events_actor_idx on public.audit_events (actor_profile_id, occurred_at desc);
create index if not exists audit_events_org_idx on public.audit_events (organization_id, occurred_at desc);
create index if not exists audit_events_action_idx on public.audit_events (action, occurred_at desc);
create index if not exists audit_events_object_idx on public.audit_events (object_type, object_id);
create index if not exists audit_events_correlation_idx on public.audit_events (correlation_id);

-- Immutability: the ledger only ever grows.
create or replace function btg.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% on % is not permitted: append-only relation', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function btg.reject_mutation();

-- The only supported write path. Actor identity is taken from the session,
-- never from the caller, so a client cannot forge an actor.
create or replace function public.record_audit_event(
  p_action text,
  p_object_type text,
  p_object_id text default null,
  p_organization_id uuid default null,
  p_actor_persona public.btg_persona default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_severity public.btg_audit_severity default 'info',
  p_correlation_id uuid default null,
  p_workflow text default null,
  p_policy_version text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'audit event requires an authenticated actor' using errcode = '28000';
  end if;
  insert into public.audit_events (
    actor_profile_id, actor_persona, organization_id, action, object_type, object_id,
    before, after, severity, correlation_id, workflow, policy_version, metadata
  ) values (
    v_actor, p_actor_persona, p_organization_id, p_action, p_object_type, p_object_id,
    p_before, p_after, p_severity, p_correlation_id, p_workflow, p_policy_version,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_audit_event(
  text, text, text, uuid, public.btg_persona, jsonb, jsonb,
  public.btg_audit_severity, uuid, text, text, jsonb) from public;
grant execute on function public.record_audit_event(
  text, text, text, uuid, public.btg_persona, jsonb, jsonb,
  public.btg_audit_severity, uuid, text, text, jsonb) to authenticated, service_role;
