-- Live/local parity: the last grant divergence, closed rather than explained.
--
-- The ten-section fingerprint matched on nine sections and differed on table
-- grants. The difference was entirely `service_role` holding INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES and TRIGGER on views of the hosted project that
-- the local cluster grants only SELECT on -- Supabase's default privileges
-- again, the same mechanism as the defect 003700 closed for tables.
--
-- Nothing was exposed: `anon` holds nothing on either side, `authenticated`'s
-- 140 grants are byte-identical, and a view here is not auto-updatable anyway
-- (a write attempt returns 55000, which a test asserts). But a parity check
-- whose difference has to be argued away is worth less than one that matches,
-- and a blanket write grant on a read model is not something to leave lying
-- around because it happens to be unusable today.
--
-- So: every view in `public` keeps exactly SELECT, for exactly the roles the
-- migrations granted it to. A guard test asserts no role holds a write on any
-- view, so the next view added cannot quietly acquire one either.

do $$
declare v_view text; v_role text;
begin
  for v_view in
    select n.nspname || '.' || quote_ident(c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      execute format(
        'revoke insert, update, delete, truncate, references, trigger on %s from %I',
        v_view, v_role);
    end loop;
  end loop;
end $$;

/* And for anything created later. 003700 revoked default privileges for the
   role it ran as; this restates it so a view added by a future migration
   starts with nothing either. */
alter default privileges in schema public revoke all on tables from anon, authenticated;
