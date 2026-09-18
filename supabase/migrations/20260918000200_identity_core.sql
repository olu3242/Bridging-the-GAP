-- W01 Batch A — E1 Identity & Access Engine core tables.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  full_name text check (full_name is null or char_length(btrim(full_name)) between 2 and 160),
  headline text check (headline is null or char_length(headline) <= 200),
  avatar_url text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  timezone text not null default 'UTC',
  locale text not null default 'en',
  primary_persona public.btg_persona not null default 'learner',
  onboarding_state public.btg_onboarding_state not null default 'not_started',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_onboarding_completed_consistency check (
    (onboarding_state = 'completed') = (onboarding_completed_at is not null)
  )
);
comment on table public.profiles is 'E1: canonical learner/actor profile, 1:1 with auth.users.';

create index if not exists profiles_primary_persona_idx on public.profiles (primary_persona);
create index if not exists profiles_onboarding_state_idx on public.profiles (onboarding_state);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  type public.btg_org_type not null,
  status public.btg_org_status not null default 'pending',
  website text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint organizations_archived_consistency check (
    (status = 'archived') = (archived_at is not null)
  )
);
comment on table public.organizations is 'E1: institutions, employers, sponsors and the platform tenant.';

create index if not exists organizations_type_status_idx on public.organizations (type, status);

-- Org-scoped persona assignment. A profile may hold several personas in one org.
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  persona public.btg_persona not null,
  status public.btg_membership_status not null default 'invited',
  title text check (title is null or char_length(title) <= 120),
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, profile_id, persona),
  -- Org-scoped personas only; learner/operator are platform-level grants.
  constraint memberships_persona_scope check (
    persona in ('mentor','reviewer','institution','employer','sponsor','operator')
  ),
  constraint memberships_active_consistency check (
    status <> 'active' or activated_at is not null
  ),
  constraint memberships_revoked_consistency check (
    (status = 'revoked') = (revoked_at is not null)
  )
);
comment on table public.memberships is 'E1: org-scoped persona grant with an explicit lifecycle.';

create index if not exists memberships_profile_active_idx
  on public.memberships (profile_id, persona) where status = 'active';
create index if not exists memberships_org_status_idx on public.memberships (organization_id, status);

-- Platform-level (tenant-free) personas: learner, operator, and platform reviewers.
create table if not exists public.persona_grants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  persona public.btg_persona not null,
  status public.btg_grant_status not null default 'active',
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, persona),
  constraint persona_grants_scope check (persona in ('learner','operator','reviewer','mentor')),
  constraint persona_grants_revoked_consistency check (
    (status = 'revoked') = (revoked_at is not null)
  )
);
comment on table public.persona_grants is 'E1: platform-level persona grant, independent of any organization.';

create index if not exists persona_grants_persona_active_idx
  on public.persona_grants (persona) where status = 'active';

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  consent_type public.btg_consent_type not null,
  policy_version text not null check (char_length(policy_version) between 1 and 40),
  granted boolean not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  source text not null default 'onboarding',
  unique (profile_id, consent_type, policy_version),
  constraint consents_revoked_requires_grant check (revoked_at is null or granted)
);
comment on table public.consents is 'E1: versioned, auditable consent record. Never overwritten in place.';

create index if not exists consents_profile_type_idx on public.consents (profile_id, consent_type);

do $$
declare t text;
begin
  foreach t in array array['profiles','organizations','memberships','persona_grants'] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function btg.touch_updated_at()', t, t);
  end loop;
end $$;
