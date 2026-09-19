-- Second grant defect of the same class as 003700, found by the live security
-- pass the certification contract insisted on. It was not the only one.
--
-- public.record_audit_event and public.enqueue_notification were granted to
-- `authenticated` in migrations 000400 and 000700, on the assumption that the
-- application layer would write audit events and notifications itself. It
-- never does: every event and every notification is written from inside a
-- governed command, and the two TypeScript wrappers had no callers at all.
--
-- On a hosted project they are therefore reachable at
-- /rest/v1/rpc/record_audit_event, and the action string is a free parameter.
-- The ledger is the platform's evidence of what happened, and
-- outcome_timeline_view reads it, so any learner could write themselves a
-- history. Proven before this fix:
--
--   select public.record_audit_event('credential.credential.issued', ...);
--   select public.record_audit_event('opportunity.application.accepted', ...);
--   -> outcome_timeline_view: joined(1), credential_issued(12),
--      opportunity_accepted(18), with zero rows in public.credentials
--
-- The funnel in learner_outcome_view was never affected: it counts canonical
-- tables, not the ledger. The timeline was, and so was the integrity of the
-- ledger itself -- including at 'critical' severity.
--
-- Fix: neither function is callable from a session. Both keep working for the
-- governed commands, which are SECURITY DEFINER and execute as the owner, so
-- they never needed the caller-facing grant.

revoke all on function public.record_audit_event(
  text, text, text, uuid, public.btg_persona, jsonb, jsonb,
  public.btg_audit_severity, uuid, text, text, jsonb) from public, anon, authenticated;

revoke all on function public.enqueue_notification(
  uuid, text, text, text, text, text, uuid, public.btg_notification_channel, jsonb)
  from public, anon, authenticated;

-- --------------------------------------------------------- search_path pins ---
-- Supabase's linter flags these ten as having a mutable search_path. All are
-- SECURITY INVOKER trigger functions, and neither `anon` nor `authenticated`
-- holds CREATE on any schema, so nothing could be planted to shadow an
-- unqualified reference -- this is hygiene rather than a live hole. Pinned
-- anyway, because the cost is nil and the linter should be clean.
alter function btg.touch_updated_at() set search_path = public, btg, pg_temp;
alter function btg.assert_transition(text, text, text) set search_path = public, btg, pg_temp;
alter function btg.enforce_transition() set search_path = public, btg, pg_temp;
alter function btg.stamp_membership_lifecycle() set search_path = public, btg, pg_temp;
alter function btg.stamp_persona_grant_lifecycle() set search_path = public, btg, pg_temp;
alter function btg.stamp_onboarding_completion() set search_path = public, btg, pg_temp;
alter function btg.reject_mutation() set search_path = public, btg, pg_temp;
alter function btg.assert_no_prerequisite_cycle() set search_path = public, btg, pg_temp;
alter function btg.reject_evidence_content_change() set search_path = public, btg, pg_temp;
alter function btg.reject_claim_rewrite() set search_path = public, btg, pg_temp;

-- ------------------------------------------- the one legitimate client write ---
-- Marking a notification read was the single surface that genuinely recorded an
-- audit event from the application, which is why the general grant existed. It
-- becomes a governed command like every other write: it marks the row and
-- records the event in one transaction, and it can only ever touch the
-- caller's own notification.
create or replace function public.mark_notification_read(p_notification_id uuid)
returns public.notifications
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_notification public.notifications;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  select * into v_notification from public.notifications
  where id = p_notification_id and profile_id = v_actor for update;
  if not found then
    -- Someone else's notification is indistinguishable from one that does not
    -- exist, so the response cannot be used to probe for them.
    raise exception 'notification not found' using errcode = 'P0002';
  end if;

  -- Idempotent: marking an already-read notification is not an error and does
  -- not write a second ledger entry.
  if v_notification.status = 'read' then
    return v_notification;
  end if;

  update public.notifications set status = 'read', read_at = now()
  where id = p_notification_id
  returning * into v_notification;

  perform public.record_audit_event(
    'notification.notification.read', 'notification', p_notification_id::text,
    v_notification.organization_id, null, null,
    jsonb_build_object('category', v_notification.category),
    'info'::public.btg_audit_severity, null, 'notifications');

  return v_notification;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated, service_role;
