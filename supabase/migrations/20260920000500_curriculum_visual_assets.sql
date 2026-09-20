-- Visual metadata extends pinned lessons. It has no authority over learning state.
create table public.curriculum_visual_assets (
  id uuid primary key,
  activity_id uuid not null references public.curriculum_lessons(activity_id),
  visual_type text not null check(visual_type in ('cover','concept','worked_example','misconception','practice_evidence')),
  version integer not null check(version>0),
  status text not null check(status in ('draft','generation_pending','generated','needs_review','approved','published','rejected','retired')),
  metadata jsonb not null,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  review_reason text,
  quality_checks jsonb,
  unique(activity_id,visual_type,version),
  check(coalesce(metadata->>'id'=id::text and metadata->>'activity_id'=activity_id::text and metadata->>'visual_type'=visual_type,false)),
  check(coalesce(length(metadata->>'alt_text')>=20 and length(metadata->>'extended_description')>=40,false)),
  check(status not in ('approved','published') or (reviewed_by is not null and reviewed_at is not null and length(btrim(review_reason))>=20)),
  check(status<>'published' or (published_at is not null and coalesce(metadata->>'asset_path','')<>'' and coalesce(metadata->>'thumbnail_path','')<>''))
);
create unique index curriculum_one_published_visual on public.curriculum_visual_assets(activity_id,visual_type) where status='published';
alter table public.curriculum_visual_assets enable row level security;
create policy curriculum_visual_read on public.curriculum_visual_assets for select to authenticated
using(btg.is_operator() or (status='published' and exists(select 1 from public.curriculum_lessons l where l.activity_id=curriculum_visual_assets.activity_id)));
grant select on public.curriculum_visual_assets to authenticated;
grant all on public.curriculum_visual_assets to service_role;

create function btg.guard_visual_asset_content() returns trigger language plpgsql as $$
begin
  if old.status in ('approved','published','retired') and
    (new.metadata is distinct from old.metadata or new.id<>old.id or new.activity_id<>old.activity_id or new.visual_type<>old.visual_type or new.version<>old.version) then
    raise exception 'reviewed visual content is immutable; create a new version' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function btg.guard_visual_asset_content() from public,anon,authenticated;
create trigger visual_content_immutable before update on public.curriculum_visual_assets for each row execute function btg.guard_visual_asset_content();

create function public.review_curriculum_visual(p_id uuid,p_decision text,p_reason text,p_expected_hash text,p_checks jsonb default '{}') returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_asset curriculum_visual_assets;
begin
  if auth.uid() is null or not btg.is_operator() then raise exception 'content operator required' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,'')))<20 then raise exception 'specific review reason required' using errcode='23514'; end if;
  select * into strict v_asset from curriculum_visual_assets where id=p_id for update;
  if p_expected_hash is null or v_asset.metadata#>>'{provenance,asset_hash}' is distinct from p_expected_hash then
    raise exception 'review must identify exact artifact bytes' using errcode='23514';
  end if;
  if (v_asset.status='needs_review' and p_decision in ('approved','rejected')) then
    if p_decision='approved' and not coalesce(p_checks @> '{"content":true,"purpose":true,"accuracy":true,"brand":true,"accessibility":true,"technical":true,"responsive":true,"versioning":true,"provenance":true}'::jsonb,false) then
      raise exception 'every visual quality gate requires a recorded human review' using errcode='23514';
    end if;
    update curriculum_visual_assets set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_reason=btrim(p_reason),quality_checks=p_checks where id=p_id;
  elsif v_asset.status='approved' and p_decision='published' then
    update curriculum_visual_assets set status='published',published_at=now() where id=p_id;
  elsif v_asset.status='published' and p_decision='retired' then
    update curriculum_visual_assets set status='retired' where id=p_id;
  else raise exception 'invalid visual lifecycle transition' using errcode='23514'; end if;
  perform record_audit_event('curriculum.visual.'||p_decision,'curriculum_visual',p_id::text,null,null,
    jsonb_build_object('status',v_asset.status),jsonb_build_object('status',p_decision,'reason',p_reason,'hash',p_expected_hash),
    'notice'::btg_audit_severity,null,'curriculum_visual');
end $$;
revoke all on function public.review_curriculum_visual(uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.review_curriculum_visual(uuid,text,text,text,jsonb) to authenticated,service_role;
