-- W01 Batch A — notification + file/storage foundation.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  channel public.btg_notification_channel not null default 'in_app',
  status public.btg_notification_status not null default 'pending',
  category text not null check (category ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  body text check (body is null or char_length(body) <= 2000),
  action_url text,
  payload jsonb not null default '{}'::jsonb,
  -- Idempotency key: the same domain event may only ever notify once.
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  unique (profile_id, channel, dedupe_key),
  constraint notifications_read_requires_status check ((status = 'read') = (read_at is not null))
);
comment on table public.notifications is 'Notification foundation. dedupe_key makes delivery idempotent.';

create index if not exists notifications_inbox_idx
  on public.notifications (profile_id, created_at desc) where status <> 'failed';
create index if not exists notifications_unread_idx
  on public.notifications (profile_id) where status in ('pending','sent');

create table if not exists public.notification_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  channels public.btg_notification_channel[] not null default array['in_app']::public.btg_notification_channel[],
  updated_at timestamptz not null default now(),
  primary key (profile_id, category)
);

create table if not exists public.file_objects (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket ~ '^[a-z0-9-]{3,48}$'),
  path text not null check (char_length(path) between 1 and 512),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  visibility public.btg_file_visibility not null default 'private',
  status public.btg_file_status not null default 'pending',
  mime_type text not null check (mime_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 104857600),
  checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, path),
  constraint file_objects_org_visibility check (
    visibility <> 'organization' or organization_id is not null
  )
);
comment on table public.file_objects is 'Registry of uploaded artifacts. Storage objects are addressed by (bucket, path).';

create index if not exists file_objects_owner_idx on public.file_objects (owner_profile_id, created_at desc);
create index if not exists file_objects_org_idx on public.file_objects (organization_id) where organization_id is not null;

do $$
declare t text;
begin
  foreach t in array array['notification_preferences','file_objects'] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function btg.touch_updated_at()', t, t);
  end loop;
end $$;
