-- public.enqueue_notification refuses to notify another profile, which is the
-- right guard for a client: a learner must not be able to push messages at
-- other learners. A governed command is a different trust context — a
-- reviewer's decision has to notify the learner whose evidence it was.
--
-- This adds an internal path with no actor check. It is NOT granted to
-- `authenticated`, so it is reachable only from security-definer commands.
-- The public, guarded function stays exactly as it was.

create or replace function btg.notify(
  p_profile_id uuid,
  p_category text,
  p_title text,
  p_dedupe_key text,
  p_body text default null,
  p_action_url text default null,
  p_organization_id uuid default null,
  p_channel public.btg_notification_channel default 'in_app',
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public, btg, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.notifications (
    profile_id, organization_id, channel, category, title, body, action_url, payload, dedupe_key
  ) values (
    p_profile_id, p_organization_id, p_channel, p_category, p_title, p_body, p_action_url,
    coalesce(p_payload, '{}'::jsonb), p_dedupe_key
  )
  on conflict (profile_id, channel, dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.notifications
    where profile_id = p_profile_id and channel = p_channel and dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end;
$$;

revoke all on function btg.notify(
  uuid, text, text, text, text, text, uuid, public.btg_notification_channel, jsonb) from public;
grant execute on function btg.notify(
  uuid, text, text, text, text, text, uuid, public.btg_notification_channel, jsonb) to service_role;
