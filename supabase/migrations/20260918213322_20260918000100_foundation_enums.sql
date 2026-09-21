-- W01 Batch A — canonical enums + private helper schema.
-- Engine: E1 Identity & Access, E16 Governance & Intelligence.

create schema if not exists btg;
comment on schema btg is 'Private BTG helper schema. Never exposed through PostgREST.';

revoke all on schema btg from public;
grant usage on schema btg to authenticated, service_role;

do $$ begin
  create type public.btg_persona as enum (
    'learner','mentor','reviewer','institution','employer','sponsor','operator'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_org_type as enum ('institution','employer','sponsor','platform');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_org_status as enum ('pending','active','suspended','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_membership_status as enum ('invited','active','suspended','revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_grant_status as enum ('active','suspended','revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_onboarding_state as enum (
    'not_started','profile','persona','goals','consent','completed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_consent_type as enum (
    'terms','privacy','ai_processing','evidence_sharing','marketing'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_audit_severity as enum ('info','notice','warning','critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_notification_channel as enum ('in_app','email','push');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_notification_status as enum ('pending','sent','read','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_file_visibility as enum ('private','organization','platform');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_file_status as enum ('pending','ready','quarantined','deleted');
exception when duplicate_object then null; end $$;

-- Shared updated_at trigger.
create or replace function btg.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
