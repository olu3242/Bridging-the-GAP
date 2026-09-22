-- W14-E — human and persona work.
--
-- No new task system: this is btg/public.workflow_work_items, the table W14-C
-- already created, given a claim/complete path for the people who do the work.
--
-- The rule that everything here enforces: **a work item never manufactures a
-- domain outcome.** Completing a human work item does not approve, verify,
-- issue or decide anything. The person performs the real governed engine
-- command in their own session, and the work item then completes only if the
-- domain shows that it happened -- the same projection guarantee W14-C applies
-- to system steps, applied to people.
--
-- And one invariant that is not configurable anywhere, by anyone:
-- **nobody may claim human work on their own run.** That is no-self-review, no
-- self-approval, no self-verification and no self-progression, in one rule
-- rather than four that can drift apart.

-- ------------------------------------------------------------------ enums ---
do $$ begin
  alter type public.btg_work_item_status add value if not exists 'escalated';
exception when others then null; end $$;

do $$ begin
  alter type public.btg_orchestration_event add value if not exists 'claimed_by_person';
exception when others then null; end $$;
do $$ begin
  alter type public.btg_orchestration_event add value if not exists 'released_by_person';
exception when others then null; end $$;
do $$ begin
  alter type public.btg_orchestration_event add value if not exists 'escalated';
exception when others then null; end $$;
do $$ begin
  alter type public.btg_orchestration_event add value if not exists 'reassigned';
exception when others then null; end $$;
