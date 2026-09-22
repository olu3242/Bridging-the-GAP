-- W01 Batch A — explicit state machines (super prompt §11).
-- One declarative transition registry, enforced by a generic trigger, so the
-- TypeScript domain layer can be asserted against the database at test time.

create table if not exists btg.state_transitions (
  machine text not null,
  from_state text not null,
  to_state text not null,
  primary key (machine, from_state, to_state)
);

insert into btg.state_transitions (machine, from_state, to_state) values
  -- membership lifecycle
  ('membership','invited','active'),
  ('membership','invited','revoked'),
  ('membership','active','suspended'),
  ('membership','active','revoked'),
  ('membership','suspended','active'),
  ('membership','suspended','revoked'),
  -- platform persona grant lifecycle
  ('persona_grant','active','suspended'),
  ('persona_grant','active','revoked'),
  ('persona_grant','suspended','active'),
  ('persona_grant','suspended','revoked'),
  -- organization lifecycle
  ('organization','pending','active'),
  ('organization','pending','archived'),
  ('organization','active','suspended'),
  ('organization','active','archived'),
  ('organization','suspended','active'),
  ('organization','suspended','archived'),
  -- learner onboarding (linear, forward only)
  ('onboarding','not_started','profile'),
  ('onboarding','profile','persona'),
  ('onboarding','persona','goals'),
  ('onboarding','goals','consent'),
  ('onboarding','consent','completed')
on conflict do nothing;

create or replace function btg.assert_transition(p_machine text, p_from text, p_to text)
returns void
language plpgsql
stable
as $$
begin
  if p_from = p_to then
    return;
  end if;
  if not exists (
    select 1 from btg.state_transitions
    where machine = p_machine and from_state = p_from and to_state = p_to
  ) then
    raise exception 'invalid % transition: % -> %', p_machine, p_from, p_to
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function btg.enforce_transition()
returns trigger
language plpgsql
as $$
declare
  machine text := tg_argv[0];
  col text := tg_argv[1];
  old_state text;
  new_state text;
begin
  execute format('select ($1).%I::text, ($2).%I::text', col, col)
    into old_state, new_state using old, new;
  perform btg.assert_transition(machine, old_state, new_state);
  return new;
end;
$$;

drop trigger if exists memberships_enforce_transition on public.memberships;
create trigger memberships_enforce_transition
  before update of status on public.memberships
  for each row execute function btg.enforce_transition('membership', 'status');

drop trigger if exists persona_grants_enforce_transition on public.persona_grants;
create trigger persona_grants_enforce_transition
  before update of status on public.persona_grants
  for each row execute function btg.enforce_transition('persona_grant', 'status');

drop trigger if exists organizations_enforce_transition on public.organizations;
create trigger organizations_enforce_transition
  before update of status on public.organizations
  for each row execute function btg.enforce_transition('organization', 'status');

drop trigger if exists profiles_enforce_onboarding_transition on public.profiles;
create trigger profiles_enforce_onboarding_transition
  before update of onboarding_state on public.profiles
  for each row execute function btg.enforce_transition('onboarding', 'onboarding_state');

-- Lifecycle timestamps are derived from the transition, never trusted from the client.
create or replace function btg.stamp_membership_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'active' then
      new.activated_at := coalesce(old.activated_at, now());
      new.suspended_at := null;
    elsif new.status = 'suspended' then
      new.suspended_at := now();
    elsif new.status = 'revoked' then
      new.revoked_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_stamp_lifecycle on public.memberships;
create trigger memberships_stamp_lifecycle
  before update of status on public.memberships
  for each row execute function btg.stamp_membership_lifecycle();

create or replace function btg.stamp_persona_grant_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'revoked' then
    new.revoked_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists persona_grants_stamp_lifecycle on public.persona_grants;
create trigger persona_grants_stamp_lifecycle
  before update of status on public.persona_grants
  for each row execute function btg.stamp_persona_grant_lifecycle();

create or replace function btg.stamp_onboarding_completion()
returns trigger
language plpgsql
as $$
begin
  if new.onboarding_state = 'completed' and old.onboarding_state is distinct from 'completed' then
    new.onboarding_completed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_stamp_onboarding on public.profiles;
create trigger profiles_stamp_onboarding
  before update of onboarding_state on public.profiles
  for each row execute function btg.stamp_onboarding_completion();
