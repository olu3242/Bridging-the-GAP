-- Gap closure (E15/E16 + E17): the application state machine declares the
-- employer-side transitions (submitted -> under_review -> shortlisted ->
-- offered -> accepted) but no command drove them, so an application could only
-- ever be submitted or withdrawn. An outcome funnel with no way to reach an
-- outcome measures nothing.
--
-- Two commands close it, on opposite sides of the table:
--   advance_application  - the hiring organization moves its own pipeline.
--   respond_to_offer     - only the learner may accept or decline an offer.
-- The registry trigger still decides which moves are legal; these commands
-- decide who may ask.

-- --------------------------------------------------------- employer side ---
create or replace function public.advance_application(
  p_application_id uuid,
  p_status public.btg_application_status,
  p_note text default null
)
returns public.applications
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_app public.applications;
  v_opportunity public.opportunities;
  v_title text;
  v_body text;
begin
  if v_actor is null then raise exception 'sign in required' using errcode = '28000'; end if;

  -- The employer decides only these. 'accepted' and 'withdrawn' belong to the
  -- learner and are rejected here even though the registry permits the move.
  if p_status not in ('under_review','shortlisted','offered','rejected') then
    raise exception 'an organization cannot move an application to %', p_status
      using errcode = '42501';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;

  select * into v_opportunity from public.opportunities where id = v_app.opportunity_id;
  -- An opportunity with no organization is platform-owned: only an operator
  -- may move its pipeline. is_org_admin(null) is never true, so the check
  -- below is stated explicitly rather than relying on a null comparison.
  if not (btg.is_operator()
          or (v_opportunity.organization_id is not null
              and btg.is_org_admin(v_opportunity.organization_id))) then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  if p_status = 'rejected' and char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'a rejection needs a reason the applicant can read'
      using errcode = 'check_violation';
  end if;

  update public.applications
  set status = p_status,
      decided_at = case when p_status in ('offered','rejected') then now() else decided_at end,
      note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
  where id = p_application_id
  returning * into v_app;

  perform public.record_audit_event(
    'opportunity.application.' || p_status::text, 'application', p_application_id::text,
    v_opportunity.organization_id, null,
    jsonb_build_object('status', v_app.status),
    jsonb_build_object('status', p_status, 'opportunity', v_opportunity.slug),
    case when p_status in ('offered','rejected') then 'notice' else 'info' end
      ::public.btg_audit_severity,
    null, 'opportunities');

  v_title := case p_status
    when 'under_review' then 'Your application is being reviewed'
    when 'shortlisted'  then 'You have been shortlisted'
    when 'offered'      then 'You have an offer'
    else 'An application was not taken forward'
  end;
  v_body := coalesce(
    nullif(btrim(coalesce(p_note, '')), ''),
    v_opportunity.title || ' at this organization.');

  perform btg.notify(
    v_app.profile_id,
    'opportunity.' || p_status::text,
    v_title,
    'application.' || p_status::text || ':' || p_application_id::text,
    v_body,
    '/opportunities',
    v_opportunity.organization_id);

  return v_app;
end;
$$;

revoke all on function public.advance_application(uuid, public.btg_application_status, text) from public;
grant execute on function public.advance_application(uuid, public.btg_application_status, text)
  to authenticated, service_role;

-- ---------------------------------------------------------- learner side ---
create or replace function public.respond_to_offer(p_application_id uuid, p_accept boolean)
returns public.applications
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_app public.applications;
  v_opportunity public.opportunities;
  v_next public.btg_application_status;
  v_admin record;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if v_actor is null or not found or v_app.profile_id <> v_actor then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if v_app.status <> 'offered' then
    raise exception 'there is no offer to respond to' using errcode = 'check_violation';
  end if;

  v_next := case when p_accept then 'accepted' else 'withdrawn' end;
  select * into v_opportunity from public.opportunities where id = v_app.opportunity_id;

  update public.applications
  set status = v_next,
      decided_at = now(),
      withdrawn_at = case when v_next = 'withdrawn' then now() else withdrawn_at end
  where id = p_application_id
  returning * into v_app;

  perform public.record_audit_event(
    'opportunity.application.' || v_next::text, 'application', p_application_id::text,
    v_opportunity.organization_id, null,
    jsonb_build_object('status', 'offered'),
    jsonb_build_object('status', v_next, 'opportunity', v_opportunity.slug),
    'critical'::public.btg_audit_severity, null, 'opportunities');

  -- The organization that made the offer is told the answer.
  for v_admin in
    select m.profile_id from public.memberships m
    where m.organization_id = v_opportunity.organization_id
      and m.status = 'active'
      and m.persona in ('institution','employer','sponsor','operator')
  loop
    perform btg.notify(
      v_admin.profile_id,
      'opportunity.offer_' || (case when p_accept then 'accepted' else 'declined' end),
      (case when p_accept then 'An offer was accepted' else 'An offer was declined' end),
      'offer_response:' || p_application_id::text,
      v_opportunity.title,
      '/organizations',
      v_opportunity.organization_id);
  end loop;

  return v_app;
end;
$$;

revoke all on function public.respond_to_offer(uuid, boolean) from public;
grant execute on function public.respond_to_offer(uuid, boolean) to authenticated, service_role;
