-- Defect: `cohort_members_select` answered "may this caller see this row?" with
-- `exists (select 1 from public.cohort_members mine ...)` -- a policy on
-- cohort_members that reads cohort_members. Postgres evaluates the inner read
-- under the same policy, so any caller who is not an operator got
--
--   infinite recursion detected in policy for relation "cohort_members"
--
-- and `cohorts_select` inherited the same fault through its own reference to
-- cohort_members. A learner in a cohort could therefore not read the cohort
-- they belong to at all, and the organization cohort panel would have hit it
-- for any non-admin caller.
--
-- The repository already solves this shape for memberships with
-- `btg.is_org_admin`: a SECURITY DEFINER helper answers the membership question
-- outside RLS, so the policy never re-enters the table it guards.

create or replace function btg.is_cohort_member(p_cohort uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.cohort_members cm
    where cm.cohort_id = p_cohort and cm.profile_id = auth.uid()
  );
$$;

revoke all on function btg.is_cohort_member(uuid) from public;
grant execute on function btg.is_cohort_member(uuid) to authenticated, service_role;

-- A learner sees a cohort they belong to; an organization admin sees the
-- cohorts their organization runs. Neither path re-enters cohort_members.
drop policy if exists cohorts_select on public.cohorts;
create policy cohorts_select on public.cohorts for select to authenticated
using (
  btg.is_operator()
  or (organization_id is not null and btg.is_org_admin(organization_id))
  or btg.is_cohort_member(id)
);

-- A learner sees who else is in a cohort they belong to, and nothing more.
drop policy if exists cohort_members_select on public.cohort_members;
create policy cohort_members_select on public.cohort_members for select to authenticated
using (btg.is_operator() or btg.is_cohort_member(cohort_id));
