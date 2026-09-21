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
