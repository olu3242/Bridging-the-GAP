-- Defect: portfolio_view is security_invoker, and it joins the reviewer's
-- profile to name who made the decision. A learner cannot read another
-- profile, so the join filtered every row out and a verified skill appeared
-- as no skill at all.
--
-- Traceability requires the learner to know who reviewed their work, so this
-- grants exactly that and nothing more: a learner may read the profile of
-- someone who decided a review of their own evidence.

drop policy if exists profiles_select_reviewer_of_own_evidence on public.profiles;
create policy profiles_select_reviewer_of_own_evidence on public.profiles
  for select to authenticated
using (
  exists (
    select 1
    from public.review_assignments r
    join public.evidence e on e.id = r.evidence_id
    where e.profile_id = auth.uid()
      and r.reviewer_profile_id = public.profiles.id
      and r.decided_at is not null
  )
);

comment on policy profiles_select_reviewer_of_own_evidence on public.profiles is
  'Narrow widening: the learner sees who decided their review, not other profiles.';
