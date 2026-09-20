-- Defect 30: the default-privilege sweep of 003700 missed `authenticated`.
--
-- 003700 closed the table defaults for both session roles, but closed the
-- function defaults for `anon` only:
--
--   alter default privileges in schema public revoke all on functions from anon;
--
-- So the hosted project still carried, for grantor `postgres` in schema
-- `public`, a default of `authenticated=X` on functions. Migrations run as
-- `postgres`. Every function a future migration creates in `public` would
-- therefore have been EXECUTE-able by `authenticated` the moment it existed --
-- without a GRANT anywhere in the repository, and without the grant matrix
-- test noticing, because the test reads the functions that exist rather than
-- the privileges the next one will inherit.
--
-- Nothing is exposed today: the 114 functions in `public` and `btg` carry
-- ACLs byte-identical to the local cluster, which has no default privileges at
-- all, so every EXECUTE now held is one a migration granted on purpose. This
-- is about the next function, and about the second half of the lesson 003700
-- taught: a default privilege is invisible until it grants something.
--
-- Both schemas, both session roles, and PUBLIC -- which is the default the
-- repository has a standing rule never to rely on.

alter default privileges in schema public
  revoke all on functions from anon, authenticated, public;
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges in schema btg
  revoke all on functions from anon, authenticated, public;
alter default privileges in schema btg
  revoke all on tables from anon, authenticated;
alter default privileges in schema btg
  revoke all on sequences from anon, authenticated;

/* `service_role` keeps its defaults. It is the trusted backend identity, it
   already holds explicit grants on everything the runtime touches, and the
   hosted platform sets those defaults itself -- revoking them buys no
   isolation (service_role bypasses RLS by design) and would fight the
   platform on every future object. The invariant worth enforcing is narrower
   and exact: no session role, and not PUBLIC, receives anything implicitly.
   A guard test asserts that, per grantor, for both schemas. */
