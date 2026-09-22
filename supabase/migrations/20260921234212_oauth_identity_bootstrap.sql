-- W01 follow-up — one application bootstrap for every auth method.
--
-- `btg.handle_new_auth_user` only read `raw_user_meta_data->>'display_name'`,
-- which is the key *our own* email signup writes. A Google identity arrives
-- with Google's keys instead (`name`, `full_name`, `given_name`, `picture`,
-- `avatar_url`), so an OAuth learner was provisioned with the local part of
-- their email address as their display name and no avatar at all.
--
-- The fix keeps a single bootstrap path — there is no separate provisioning
-- model for OAuth users — and simply widens the metadata the one trigger
-- understands. It stays idempotent (`on conflict do nothing`), so a returning
-- Google user, an identity linked onto an existing account, or a replayed
-- insert can never produce a second application identity.

create or replace function btg.auth_display_name(p_meta jsonb, p_email text)
returns text language sql immutable set search_path = pg_temp as $$
  -- Ordered by how much the person actually chose the value:
  --   display_name — typed into our own signup form
  --   full_name / name — the provider's profile name (Google sends both)
  --   given_name — a first name is better than an email fragment
  --   email local part — last resort, never blank
  select left(
    coalesce(
      nullif(btrim(coalesce(p_meta->>'display_name', '')), ''),
      nullif(btrim(coalesce(p_meta->>'full_name', '')), ''),
      nullif(btrim(coalesce(p_meta->>'name', '')), ''),
      nullif(btrim(coalesce(p_meta->>'given_name', '')), ''),
      nullif(btrim(split_part(coalesce(p_email, ''), '@', 1)), ''),
      'BTG learner'
    ),
    80
  );
$$;

create or replace function btg.auth_full_name(p_meta jsonb)
returns text language sql immutable set search_path = pg_temp as $$
  select left(
    coalesce(
      nullif(btrim(coalesce(p_meta->>'full_name', '')), ''),
      nullif(btrim(coalesce(p_meta->>'name', '')), '')
    ),
    160
  );
$$;

create or replace function btg.auth_avatar_url(p_meta jsonb)
returns text language sql immutable set search_path = pg_temp as $$
  -- Supabase normalises Google's `picture` to `avatar_url`; older payloads and
  -- other providers still send `picture`, so accept both.
  select coalesce(
    nullif(btrim(coalesce(p_meta->>'avatar_url', '')), ''),
    nullif(btrim(coalesce(p_meta->>'picture', '')), '')
  );
$$;

create or replace function btg.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_display_name text := btg.auth_display_name(v_meta, new.email);
  v_full_name text := btg.auth_full_name(v_meta);
  v_intent text := nullif(btrim(coalesce(v_meta->>'intended_persona', '')), '');
  v_persona public.btg_persona := 'learner';
begin
  -- The intent only ever pre-selects the onboarding persona step; it grants
  -- nothing. Organization personas still require a membership. (Unchanged from
  -- the journey-lifecycle definition this replaces.)
  if v_intent in ('learner','mentor','reviewer','institution','employer','sponsor') then
    v_persona := v_intent::public.btg_persona;
  end if;

  -- A display name shorter than the column's own floor would abort signup, so
  -- pad the rare one-character provider name rather than reject the account.
  if char_length(btrim(v_display_name)) < 2 then
    v_display_name := btrim(v_display_name) || ' ' || 'learner';
  end if;

  insert into public.profiles (id, display_name, full_name, avatar_url, locale, primary_persona)
  values (
    new.id,
    v_display_name,
    case when char_length(btrim(coalesce(v_full_name, ''))) between 2 and 160 then v_full_name end,
    btg.auth_avatar_url(v_meta),
    coalesce(nullif(v_meta->>'locale', ''), 'en'),
    v_persona
  )
  on conflict (id) do nothing;

  insert into public.persona_grants (profile_id, persona, status)
  values (new.id, 'learner', 'active')
  on conflict (profile_id, persona) do nothing;

  -- account_created. Written directly: there is no session yet during signup,
  -- so public.record_audit_event (which stamps auth.uid()) cannot be used.
  -- `auth_provider` records which method the account arrived through, so the
  -- ledger distinguishes an email signup from a Google one without there being
  -- two provisioning paths.
  insert into public.audit_events (
    actor_profile_id, actor_persona, action, object_type, object_id, after, severity, workflow
  ) values (
    new.id, v_persona, 'identity.session.signed_up', 'profile', new.id::text,
    jsonb_build_object(
      'intended_persona', v_intent,
      'auth_provider', coalesce(new.raw_app_meta_data->>'provider', 'email')
    ),
    'notice', 'signup'
  );

  return new;
end;
$$;

-- The helpers are internal: `btg` is not in the API surface, and only the
-- definer trigger calls them.
revoke all on function
  btg.auth_display_name(jsonb, text), btg.auth_full_name(jsonb), btg.auth_avatar_url(jsonb)
  from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function btg.handle_new_auth_user();

/*
 * Backfill: profiles already provisioned from an OAuth identity before this
 * migration carry the email local part as their display name and no avatar.
 * Repair only those rows — never one the learner has since edited, which is
 * why the update is keyed on the display name still matching the email
 * fragment exactly.
 */
update public.profiles p
   set display_name = btg.auth_display_name(u.raw_user_meta_data, u.email),
       full_name = coalesce(p.full_name, nullif(btg.auth_full_name(u.raw_user_meta_data), '')),
       avatar_url = coalesce(p.avatar_url, btg.auth_avatar_url(u.raw_user_meta_data)),
       updated_at = now()
  from auth.users u
 where u.id = p.id
   and p.display_name = split_part(coalesce(u.email, ''), '@', 1)
   and btg.auth_display_name(u.raw_user_meta_data, u.email)
       <> split_part(coalesce(u.email, ''), '@', 1)
   and char_length(btrim(btg.auth_display_name(u.raw_user_meta_data, u.email))) between 2 and 80;
