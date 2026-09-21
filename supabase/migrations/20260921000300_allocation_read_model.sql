-- W21 governed allocator projection. No eligibility evidence or private
-- learning records are returned to the allocator.
create function public.get_program_seat_operations(p_program_id uuid,p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public,btg,pg_temp as $$
declare v_pools jsonb; v_queue jsonb;
begin
 if auth.uid() is null or not exists(select 1 from funding_programs p where p.id=p_program_id
  and (btg.is_operator() or btg.is_org_admin(p.organization_id))) then
  raise exception 'not authorized' using errcode='42501';
 end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit must be 1 to 100' using errcode='23514'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'cohort_id',f.cohort_id,'currency',f.currency,
  'funded_minor',f.funded_minor::text,'reserved_minor',f.reserved_minor::text,'spent_minor',f.spent_minor::text,
  'available_minor',(f.funded_minor-f.reserved_minor-f.spent_minor)::text) order by f.id),'[]')
 into v_pools from funding_pools f where f.program_id=p_program_id;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into v_queue from (
  select w.id,pr.display_name,w.created_at from funding_waitlist w
  join eligibility_assessments a on a.id=w.assessment_id
  join funding_programs p on p.id=w.program_id join profiles pr on pr.id=w.profile_id
  where w.program_id=p_program_id and w.profile_id<>auth.uid()
   and w.status in ('waitlisted','matched','accepted') and a.decision='eligible'
   and a.profile_id=w.profile_id and a.program_id=w.program_id and a.superseded_at is null
   and a.policy_version=p.policy_version and p.status='active'
   and (p_after is null or w.id>p_after)
  order by w.id limit p_limit
 ) q;
 return jsonb_build_object('pools',v_pools,'queue',v_queue);
end $$;
revoke all on function public.get_program_seat_operations(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.get_program_seat_operations(uuid,uuid,integer) to authenticated;
