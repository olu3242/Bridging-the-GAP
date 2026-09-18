-- W01 Batch A — authorization helpers, RLS policies, grants.
-- Authorization is enforced at the database boundary; server code never relies
-- on client-side guards (super prompt §10).

-- ---------------------------------------------------------------- helpers ---
create or replace function btg.current_profile_id()
returns uuid language sql stable set search_path = public, pg_temp as $$
  select auth.uid();
$$;

create or replace function btg.has_platform_persona(p_persona public.btg_persona)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.persona_grants g
    where g.profile_id = auth.uid() and g.persona = p_persona and g.status = 'active'
  );
$$;

create or replace function btg.is_operator()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.persona_grants g
    where g.profile_id = auth.uid() and g.persona = 'operator' and g.status = 'active'
  );
$$;

create or replace function btg.is_active_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.profile_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function btg.has_org_persona(p_org uuid, p_persona public.btg_persona)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.profile_id = auth.uid()
      and m.persona = p_persona and m.status = 'active'
  );
$$;

-- Org admin = a governing persona inside that organization.
create or replace function btg.is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.profile_id = auth.uid() and m.status = 'active'
      and m.persona in ('institution','employer','sponsor','operator')
  ) or btg.is_operator();
$$;

create or replace function btg.governed_org_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.organization_id from public.memberships m
  where m.profile_id = auth.uid() and m.status = 'active'
    and m.persona in ('institution','employer','sponsor','operator');
$$;

grant execute on function
  btg.current_profile_id(), btg.is_operator(), btg.governed_org_ids(),
  btg.has_platform_persona(public.btg_persona), btg.is_active_member(uuid),
  btg.has_org_persona(uuid, public.btg_persona), btg.is_org_admin(uuid)
  to authenticated, service_role;

-- ------------------------------------------------------- new-user bootstrap ---
-- A new auth user always lands as a learner with a profile. Runs as definer so
-- signup does not require any client-side privilege.
create or replace function btg.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
begin
  insert into public.profiles (id, display_name, full_name, locale)
  values (
    new.id,
    coalesce(v_name, split_part(coalesce(new.email, 'learner@btg'), '@', 1)),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    coalesce(nullif(new.raw_user_meta_data->>'locale', ''), 'en')
  )
  on conflict (id) do nothing;

  insert into public.persona_grants (profile_id, persona, status)
  values (new.id, 'learner', 'active')
  on conflict (profile_id, persona) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function btg.handle_new_auth_user();

-- -------------------------------------------------------------------- RLS ---
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.persona_grants enable row level security;
alter table public.consents enable row level security;
alter table public.audit_events enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.file_objects enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or btg.is_operator()
  or exists (
    select 1 from public.memberships m
    where m.profile_id = public.profiles.id and m.status = 'active'
      and m.organization_id in (select btg.governed_org_ids())
  )
);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid() and deleted_at is null)
with check (id = auth.uid());

drop policy if exists profiles_update_operator on public.profiles;
create policy profiles_update_operator on public.profiles for update to authenticated
using (btg.is_operator()) with check (btg.is_operator());

-- organizations
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
using (btg.is_active_member(id) or btg.is_operator() or created_by = auth.uid());

drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert on public.organizations for insert to authenticated
with check (created_by = auth.uid() and status = 'pending');

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update to authenticated
using (btg.is_org_admin(id)) with check (btg.is_org_admin(id));

-- memberships
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
using (profile_id = auth.uid() or btg.is_org_admin(organization_id));

drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert to authenticated
with check (btg.is_org_admin(organization_id) and status = 'invited');

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update to authenticated
using (btg.is_org_admin(organization_id)) with check (btg.is_org_admin(organization_id));

-- persona_grants: platform authority, operator-governed only.
drop policy if exists persona_grants_select on public.persona_grants;
create policy persona_grants_select on public.persona_grants for select to authenticated
using (profile_id = auth.uid() or btg.is_operator());

drop policy if exists persona_grants_write on public.persona_grants;
create policy persona_grants_write on public.persona_grants for insert to authenticated
with check (btg.is_operator());

drop policy if exists persona_grants_update on public.persona_grants;
create policy persona_grants_update on public.persona_grants for update to authenticated
using (btg.is_operator()) with check (btg.is_operator());

-- consents
drop policy if exists consents_select on public.consents;
create policy consents_select on public.consents for select to authenticated
using (profile_id = auth.uid() or btg.is_operator());

drop policy if exists consents_insert on public.consents;
create policy consents_insert on public.consents for insert to authenticated
with check (profile_id = auth.uid());

drop policy if exists consents_update on public.consents;
create policy consents_update on public.consents for update to authenticated
using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- audit_events: readable by subject / governing org / operator. Writes only
-- through public.record_audit_event (security definer), never directly.
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated
using (
  actor_profile_id = auth.uid()
  or btg.is_operator()
  or (organization_id is not null and organization_id in (select btg.governed_org_ids()))
);

-- notifications
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
using (profile_id = auth.uid() or btg.is_operator());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists notification_preferences_all on public.notification_preferences;
create policy notification_preferences_all on public.notification_preferences for all to authenticated
using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- file_objects
drop policy if exists file_objects_select on public.file_objects;
create policy file_objects_select on public.file_objects for select to authenticated
using (
  owner_profile_id = auth.uid()
  or btg.is_operator()
  or (visibility = 'platform' and status = 'ready')
  or (visibility = 'organization' and organization_id is not null and btg.is_active_member(organization_id))
);

drop policy if exists file_objects_insert on public.file_objects;
create policy file_objects_insert on public.file_objects for insert to authenticated
with check (owner_profile_id = auth.uid() and status = 'pending');

drop policy if exists file_objects_update on public.file_objects;
create policy file_objects_update on public.file_objects for update to authenticated
using (owner_profile_id = auth.uid() or btg.is_operator())
with check (owner_profile_id = auth.uid() or btg.is_operator());

drop policy if exists file_objects_delete on public.file_objects;
create policy file_objects_delete on public.file_objects for delete to authenticated
using (owner_profile_id = auth.uid() or btg.is_operator());

-- ----------------------------------------------------------------- grants ---
grant usage on schema public to authenticated, service_role;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.organizations to authenticated;
grant select, insert, update on public.memberships to authenticated;
grant select, insert, update on public.persona_grants to authenticated;
grant select, insert, update on public.consents to authenticated;
grant select on public.audit_events to authenticated;          -- insert via function only
grant select, update on public.notifications to authenticated; -- insert via function only
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.file_objects to authenticated;
grant all on all tables in schema public to service_role;
