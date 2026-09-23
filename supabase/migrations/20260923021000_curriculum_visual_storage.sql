-- Move curriculum visuals off the deployment's filesystem and into object storage.
--
-- The filesystem path was never a safe production dependency: a serverless
-- deployment's bundle is not a durable asset store, and a visual that fails to
-- read there is indistinguishable from one that was never generated. The
-- governance model does not change — `curriculum_visual_assets` remains the
-- metadata and review authority, the provenance hash still decides whether
-- bytes are trustworthy, and review still gates publication.

-- Where the bytes live. Kept as its own column rather than inside `metadata`
-- because metadata is immutable once reviewed (btg.guard_visual_asset_content),
-- and an object can legitimately be re-uploaded to the same reviewed asset.
alter table public.curriculum_visual_assets
  add column if not exists storage_bucket text,
  add column if not exists storage_object_path text;

comment on column public.curriculum_visual_assets.storage_object_path is
  'Object key within storage_bucket. The authenticated asset route reads bytes from here and verifies them against metadata.provenance.asset_hash before serving.';

-- A published visual must be retrievable. Without this, publication could point
-- at bytes that exist only on a build machine.
alter table public.curriculum_visual_assets
  drop constraint if exists curriculum_visual_published_has_object;
alter table public.curriculum_visual_assets
  add constraint curriculum_visual_published_has_object
  check (status <> 'published' or coalesce(storage_object_path, '') <> '');

-- Supabase's storage schema does not exist on the bare Postgres cluster used for
-- local schema and RLS certification, so bucket and policy creation is
-- conditional. On a hosted project this runs; locally it is a no-op and the rest
-- of the migration still applies, which keeps one migration list for both.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    -- Private bucket: nothing here is world-readable.
    insert into storage.buckets (id, name, public)
    values ('curriculum-visuals', 'curriculum-visuals', false)
    on conflict (id) do update set public = false;

    execute $policy$
      drop policy if exists curriculum_visuals_read on storage.objects;
      create policy curriculum_visuals_read on storage.objects for select to authenticated
      using (
        bucket_id = 'curriculum-visuals'
        and (
          btg.is_operator()
          or exists (
            select 1 from public.curriculum_visual_assets a
            where a.storage_object_path = storage.objects.name
              and a.storage_bucket = 'curriculum-visuals'
              and a.status = 'published'
          )
        )
      );
    $policy$;

    -- Writes are an operator action, performed out of band with a service role.
    -- No session role may write curriculum visual bytes.
    execute $policy$
      drop policy if exists curriculum_visuals_write on storage.objects;
    $policy$;
  end if;
end $$;
