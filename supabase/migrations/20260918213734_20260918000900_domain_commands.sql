-- W01 Batch A — authoritative domain commands.
-- Multi-table writes run as one transaction inside the database so a partially
-- onboarded learner or an organization without an owner cannot exist.

-- ------------------------------------------------- organization provisioning ---
create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_type public.btg_org_type,
  p_website text default null,
  p_country_code text default null,
  p_correlation_id uuid default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_persona public.btg_persona;
  v_org public.organizations;
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  if p_type = 'platform' then
    raise exception 'platform organizations are provisioned by operators only' using errcode = '42501';
  end if;

  v_persona := case p_type
    when 'institution' then 'institution'::public.btg_persona
    when 'employer' then 'employer'::public.btg_persona
    when 'sponsor' then 'sponsor'::public.btg_persona
  end;

  insert into public.organizations (slug, name, type, status, website, country_code, created_by)
  values (lower(btrim(p_slug)), btrim(p_name), p_type, 'pending', nullif(btrim(coalesce(p_website, '')), ''),
          nullif(btrim(coalesce(p_country_code, '')), ''), v_actor)
  returning * into v_org;

  -- The founder is an active governing member from the first moment.
  insert into public.memberships (organization_id, profile_id, persona, status, invited_by, activated_at)
  values (v_org.id, v_actor, v_persona, 'active', v_actor, now());

  perform public.record_audit_event(
    'identity.organization.created', 'organization', v_org.id::text, v_org.id, v_persona,
    null, jsonb_build_object('slug', v_org.slug, 'name', v_org.name, 'type', v_org.type),
    'notice'::public.btg_audit_severity, p_correlation_id, 'organization_provisioning'
  );

  return v_org;
end;
$$;

revoke all on function public.create_organization(text, text, public.btg_org_type, text, text, uuid) from public;
grant execute on function public.create_organization(text, text, public.btg_org_type, text, text, uuid)
  to authenticated, service_role;

-- ------------------------------------------------------- onboarding command ---
-- One atomic step. The onboarding state machine trigger rejects out-of-order
-- steps, so a client cannot skip consent by posting the final step directly.
create or replace function public.complete_onboarding_step(
  p_step public.btg_onboarding_state,
  p_payload jsonb,
  p_policy_version text default null,
  p_correlation_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, btg, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles;
  v_before public.profiles;
  v_next public.btg_onboarding_state;
  v_consent record;
begin
  if v_actor is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  select * into v_before from public.profiles where id = v_actor for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  v_next := case p_step
    when 'profile' then 'persona'
    when 'persona' then 'goals'
    when 'goals' then 'consent'
    when 'consent' then 'completed'
    else null
  end;
  if v_next is null then
    raise exception 'unsupported onboarding step: %', p_step using errcode = 'check_violation';
  end if;

  -- The learner must actually be standing on this step.
  if v_before.onboarding_state <> p_step
     and not (p_step = 'profile' and v_before.onboarding_state = 'not_started') then
    raise exception 'invalid onboarding transition: % -> %', v_before.onboarding_state, p_step
      using errcode = 'check_violation';
  end if;

  if p_step = 'profile' then
    -- A learner who has never begun first *enters* onboarding. The registry
    -- owns both hops (not_started -> profile -> persona); the command never
    -- jumps a state the machine does not allow.
    if v_before.onboarding_state = 'not_started' then
      update public.profiles set onboarding_state = 'profile' where id = v_actor;
    end if;

    update public.profiles set
      display_name = coalesce(nullif(btrim(p_payload->>'displayName'), ''), display_name),
      full_name = nullif(btrim(coalesce(p_payload->>'fullName', '')), ''),
      country_code = nullif(btrim(coalesce(p_payload->>'countryCode', '')), ''),
      timezone = coalesce(nullif(btrim(coalesce(p_payload->>'timezone', '')), ''), timezone),
      onboarding_state = v_next
    where id = v_actor;

  elsif p_step = 'persona' then
    update public.profiles set
      primary_persona = coalesce((p_payload->>'primaryPersona')::public.btg_persona, primary_persona),
      headline = nullif(btrim(coalesce(p_payload->>'headline', '')), ''),
      onboarding_state = v_next
    where id = v_actor;

  elsif p_step = 'goals' then
    insert into public.learner_profiles (
      profile_id, primary_goal, focus_areas, experience_level, weekly_hours, target_outcome, education_stage
    ) values (
      v_actor,
      btrim(p_payload->>'primaryGoal'),
      coalesce(
        (select array_agg(btrim(value)) from jsonb_array_elements_text(coalesce(p_payload->'focusAreas', '[]'::jsonb))),
        '{}'::text[]
      ),
      coalesce((p_payload->>'experienceLevel')::public.btg_experience_level, 'beginner'),
      coalesce((p_payload->>'weeklyHours')::smallint, 5),
      nullif(btrim(coalesce(p_payload->>'targetOutcome', '')), ''),
      nullif(btrim(coalesce(p_payload->>'educationStage', '')), '')
    )
    on conflict (profile_id) do update set
      primary_goal = excluded.primary_goal,
      focus_areas = excluded.focus_areas,
      experience_level = excluded.experience_level,
      weekly_hours = excluded.weekly_hours,
      target_outcome = excluded.target_outcome,
      education_stage = excluded.education_stage;

    update public.profiles set onboarding_state = v_next where id = v_actor;

  elsif p_step = 'consent' then
    if coalesce((p_payload->>'terms')::boolean, false) is not true
       or coalesce((p_payload->>'privacy')::boolean, false) is not true
       or coalesce((p_payload->>'aiProcessing')::boolean, false) is not true then
      raise exception 'required consent missing' using errcode = 'check_violation';
    end if;

    for v_consent in
      select * from (values
        ('terms'::public.btg_consent_type, coalesce((p_payload->>'terms')::boolean, false)),
        ('privacy', coalesce((p_payload->>'privacy')::boolean, false)),
        ('ai_processing', coalesce((p_payload->>'aiProcessing')::boolean, false)),
        ('evidence_sharing', coalesce((p_payload->>'evidenceSharing')::boolean, false)),
        ('marketing', coalesce((p_payload->>'marketing')::boolean, false))
      ) as t(consent_type, granted)
    loop
      insert into public.consents (profile_id, consent_type, policy_version, granted, source)
      values (v_actor, v_consent.consent_type, coalesce(p_policy_version, 'unversioned'), v_consent.granted, 'onboarding')
      on conflict (profile_id, consent_type, policy_version)
        do update set granted = excluded.granted, granted_at = now();
    end loop;

    update public.profiles set onboarding_state = v_next where id = v_actor;
  end if;

  select * into v_profile from public.profiles where id = v_actor;

  perform public.record_audit_event(
    case when v_next = 'completed'
      then 'identity.onboarding.completed' else 'identity.onboarding.step_completed' end,
    'profile', v_actor::text, null, v_profile.primary_persona,
    jsonb_build_object('onboarding_state', v_before.onboarding_state),
    jsonb_build_object('onboarding_state', v_profile.onboarding_state, 'step', p_step),
    (case when v_next = 'completed' then 'notice' else 'info' end)::public.btg_audit_severity,
    p_correlation_id, 'onboarding', p_policy_version
  );

  if v_next = 'completed' then
    perform public.enqueue_notification(
      v_actor, 'onboarding.completed', 'Your BTG pathway is ready to start',
      'onboarding.completed:' || v_actor::text,
      'Your baseline diagnostic is the next step towards your first verified skill.',
      '/dashboard'
    );
  end if;

  return v_profile;
end;
$$;

revoke all on function public.complete_onboarding_step(
  public.btg_onboarding_state, jsonb, text, uuid) from public;
grant execute on function public.complete_onboarding_step(
  public.btg_onboarding_state, jsonb, text, uuid) to authenticated, service_role;
