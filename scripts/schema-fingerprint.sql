-- Ten-section schema fingerprint.
--
-- Run against the local certification cluster and against the hosted project;
-- identical output proves the two schemas agree, rather than asserting it.
--
--   psql "$BTG_TEST_DATABASE_URL" -At -F'|' -f scripts/schema-fingerprint.sql
--
-- Deliberate exclusions, each for a reason:
--   * extension-owned functions -- the local cluster installs pgcrypto into
--     public via the test shim; a hosted project puts it in extensions.
--   * the auth schema -- local is a shim, hosted is real Supabase Auth.
--   * grantees other than anon/authenticated/service_role -- a hosted project
--     carries platform roles a bare cluster has never heard of.
--   * default privileges whose grantor is a platform role (`supabase_admin`) --
--     section 11 covers the grantors that create objects here. The hosted
--     project carries `supabase_admin` defaults granting anon and authenticated
--     everything in `public`; `postgres` is not a member of that role, so no
--     migration can revoke them, and nothing inherits them either: every
--     relation in `public` and `btg` is owned by `postgres`. It is reported as
--     an external condition, not folded into a matching hash.
--
-- Every aggregate sorts `collate "C"`. Without it the fingerprint is
-- collation-dependent: the local cluster and the hosted project order text
-- differently, so two identical schemas can hash differently. That produced a
-- false mismatch on the transition registry before this was pinned.
with
columns_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select c.table_name || '.' || c.column_name || ':' || c.udt_name || ':' ||
           c.is_nullable || ':' || coalesce(c.column_default, '-') as x
    from information_schema.columns c
    where c.table_schema in ('public','btg')
  ) s
),
constraints_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select n.nspname || '.' || con.conname || ':' || pg_get_constraintdef(con.oid) as x
    from pg_constraint con
    join pg_namespace n on n.oid = con.connamespace
    where n.nspname in ('public','btg')
  ) s
),
indexes_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select schemaname || '.' || indexname || ':' || indexdef as x
    from pg_indexes where schemaname in ('public','btg')
  ) s
),
policies_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' ||
           coalesce(qual, '-') || ':' || coalesce(with_check, '-') as x
    from pg_policies where schemaname in ('public','btg')
  ) s
),
rls_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select n.nspname || '.' || c.relname || ':' || c.relrowsecurity::text || ':' ||
           c.relforcerowsecurity::text as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','btg') and c.relkind = 'r'
  ) s
),
triggers_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select n.nspname || '.' || c.relname || '.' || t.tgname || ':' ||
           pg_get_triggerdef(t.oid) as x
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','btg') and not t.tgisinternal
  ) s
),
functions_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select n.nspname || '.' || p.proname || '(' ||
           pg_get_function_identity_arguments(p.oid) || '):' ||
           md5(p.prosrc) || ':' || p.prosecdef::text || ':' ||
           coalesce(array_to_string(p.proconfig, ','), '-') as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','btg')
      and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')
  ) s
),
function_acl_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select n.nspname || '.' || p.proname || '(' ||
           pg_get_function_identity_arguments(p.oid) || '):' || r.rolname || ':' ||
           has_function_privilege(r.rolname, p.oid, 'EXECUTE')::text as x
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','authenticated','service_role']) as rolname) r
    where n.nspname in ('public','btg')
      and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')
  ) s
),
grants_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select 'table:' || table_schema || '.' || table_name || ':' || grantee || ':' ||
           privilege_type as x
    from information_schema.role_table_grants
    where table_schema in ('public','btg')
      and grantee in ('anon','authenticated','service_role')
    union all
    select 'column:' || table_schema || '.' || table_name || '.' || column_name || ':' ||
           grantee || ':' || privilege_type as x
    from information_schema.column_privileges
    where table_schema in ('public','btg')
      and grantee in ('anon','authenticated','service_role')
  ) s
),
transitions_fp as (
  select md5(string_agg(x, E'\n' order by x collate "C")) as fp from (
    select machine || ':' || from_state || '->' || to_state as x
    from btg.state_transitions
  ) s
),
/* Section 11 is about the object that does not exist yet. Sections 08 and 09
   read the privileges objects hold; a default privilege grants the next one
   something with no GRANT written anywhere. Defect 30 was exactly that: a
   default of `authenticated=X` on functions in `public`, left behind because
   003700's revoke named `anon` only. Empty on both sides is the invariant --
   no session role, and not PUBLIC, receives anything implicitly. */
implicit_fp as (
  select coalesce(md5(string_agg(x, E'\n' order by x collate "C")), '(none)') as fp from (
    select pg_get_userbyid(d.defaclrole) || ':' || n.nspname || ':' ||
           d.defaclobjtype::text || ':' || a::text as x
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join unnest(d.defaclacl) a
    where n.nspname in ('public','btg')
      and pg_get_userbyid(d.defaclrole) in (
        select distinct pg_get_userbyid(c.relowner)
        from pg_class c join pg_namespace cn on cn.oid = c.relnamespace
        where cn.nspname in ('public','btg'))
      and (a::text like 'anon=%'
           or a::text like 'authenticated=%'
           or a::text like '=%')
  ) s
)
select '01_columns' as section, fp from columns_fp
union all select '02_constraints', fp from constraints_fp
union all select '03_indexes', fp from indexes_fp
union all select '04_policies', fp from policies_fp
union all select '05_rls', fp from rls_fp
union all select '06_triggers', fp from triggers_fp
union all select '07_functions', fp from functions_fp
union all select '08_function_acl', fp from function_acl_fp
union all select '09_grants', fp from grants_fp
union all select '10_transitions', fp from transitions_fp
union all select '11_implicit_grants', fp from implicit_fp
order by section;
