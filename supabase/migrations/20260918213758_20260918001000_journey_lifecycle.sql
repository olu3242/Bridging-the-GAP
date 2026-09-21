-- Landing → product convergence.
-- Forward migration: carries the persona intent captured by the landing's
-- partner CTAs into the profile, and records the lifecycle events that the
-- analytics contract needs, using the existing audit ledger rather than a new
-- vendor or a parallel events table.

create or replace function btg.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
  v_intent text := nullif(btrim(coalesce(new.raw_user_meta_data->>'intended_persona', '')), '');
  v_persona public.btg_persona := 'learner';
begin
  -- The intent only ever pre-selects the onboarding persona step; it grants
  -- nothing. Organization personas still require a membership.
  if v_intent in ('learner','mentor','reviewer','institution','employer','sponsor') then
    v_persona := v_intent::public.btg_persona;
  end if;

  insert into public.profiles (id, display_name, full_name, locale, primary_persona)
  values (
    new.id,
    coalesce(v_name, split_part(coalesce(new.email, 'learner@btg'), '@', 1)),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    coalesce(nullif(new.raw_user_meta_data->>'locale', ''), 'en'),
    v_persona
  )
  on conflict (id) do nothing;

  insert into public.persona_grants (profile_id, persona, status)
  values (new.id, 'learner', 'active')
  on conflict (profile_id, persona) do nothing;

  -- account_created. Written directly: there is no session yet during signup,
  -- so public.record_audit_event (which stamps auth.uid()) cannot be used.
  insert into public.audit_events (
    actor_profile_id, actor_persona, action, object_type, object_id, after, severity, workflow
  ) values (
    new.id, v_persona, 'identity.session.signed_up', 'profile', new.id::text,
    jsonb_build_object('intended_persona', v_intent),
    'notice', 'signup'
  );

  return new;
end;
$$;

-- onboarding_started, emitted on the hop out of not_started.
create or replace function btg.stamp_onboarding_started()
returns trigger language plpgsql security definer set search_path = public, btg, pg_temp as $$
begin
  if old.onboarding_state = 'not_started' and new.onboarding_state <> 'not_started' then
    insert into public.audit_events (
      actor_profile_id, actor_persona, action, object_type, object_id, after, workflow
    ) values (
      new.id, new.primary_persona, 'identity.onboarding.started', 'profile', new.id::text,
      jsonb_build_object('onboarding_state', new.onboarding_state), 'onboarding'
    );
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_audit_onboarding_started on public.profiles;
create trigger profiles_audit_onboarding_started
  after update of onboarding_state on public.profiles
  for each row execute function btg.stamp_onboarding_started();
