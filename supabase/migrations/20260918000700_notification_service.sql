-- W01 Batch A — idempotent notification write path.

create or replace function public.enqueue_notification(
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
language plpgsql
security definer
set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'notification requires an authenticated actor' using errcode = '28000';
  end if;
  -- A caller may only notify itself unless it is an operator.
  if p_profile_id <> v_actor and not btg.is_operator() then
    raise exception 'not authorized to notify another profile' using errcode = '42501';
  end if;

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

revoke all on function public.enqueue_notification(
  uuid, text, text, text, text, text, uuid, public.btg_notification_channel, jsonb) from public;
grant execute on function public.enqueue_notification(
  uuid, text, text, text, text, text, uuid, public.btg_notification_channel, jsonb)
  to authenticated, service_role;
