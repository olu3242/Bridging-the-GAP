-- W21: explicit enrollment acceptance; identity, funding and learning remain
-- separate canonical records. Reuse the existing seat as the admission source.
create table public.program_enrollments (
 id uuid primary key default gen_random_uuid(),
 program_id uuid not null references public.funding_programs(id),
 profile_id uuid not null references public.profiles(id),
 seat_id uuid not null unique references public.funded_seats(id),
 cohort_id uuid references public.cohorts(id),
 status text not null default 'enrolled' check(status in ('enrolled','withdrawn')),
 enrolled_at timestamptz not null default now(),
 withdrawn_at timestamptz,
 source text not null check(source in ('learner_acceptance','existing_activation')),
 check((status='withdrawn')=(withdrawn_at is not null))
);
create unique index program_enrollment_one_current on public.program_enrollments(program_id,profile_id) where status='enrolled';
create index program_enrollments_profile on public.program_enrollments(profile_id,enrolled_at desc);
alter table public.program_enrollments enable row level security;
create policy enrollment_read on public.program_enrollments for select to authenticated using (
 profile_id=auth.uid() or btg.is_operator() or exists (
  select 1 from funding_programs p join organizations o on o.id=p.organization_id
  where p.id=program_id and o.type='institution' and btg.is_org_admin(o.id)
 )
);
revoke all on public.program_enrollments from public,anon,authenticated,service_role;
grant select on public.program_enrollments to authenticated;

-- Preserve previously activated admissions with explicit migration provenance.
-- Fail rather than silently merge conflicting current admissions.
insert into public.program_enrollments(program_id,profile_id,seat_id,cohort_id,enrolled_at,source)
select f.program_id,s.profile_id,s.id,s.cohort_id,coalesce(s.activated_at,s.allocated_at,s.created_at),'existing_activation'
from public.funded_seats s join public.funding_pools f on f.id=s.pool_id
where s.status in ('active','activated','completed') and s.profile_id is not null;

create function public.accept_funded_seat(p_seat_id uuid) returns uuid
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funded_seats%rowtype; p funding_programs%rowtype; v_id uuid;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 perform pg_advisory_xact_lock(hashtextextended('funding-pool:'||(select pool_id from funded_seats where id=p_seat_id),0));
 select * into v from funded_seats where id=p_seat_id for update;
 if not found or v.profile_id is distinct from auth.uid() then raise exception 'seat unavailable' using errcode='42501'; end if;
 select p0.* into p from funding_programs p0 join funding_pools f on f.program_id=p0.id where f.id=v.pool_id;
 -- Serializes enrollment across distinct pools within one program.
 perform pg_advisory_xact_lock(hashtextextended('enrollment:'||p.id||':'||auth.uid(),0));
 select id into v_id from program_enrollments where seat_id=v.id and status='enrolled';
 if found and v.status in ('allocated','active','activated','completed') then return v_id; end if;
 if v.status<>'allocated' or (v.reserved_until is not null and v.reserved_until<=now()) or p.status<>'active' then
  raise exception 'current allocated seat required' using errcode='23514';
 end if;
 if not exists(select 1 from eligibility_assessments a where a.id=v.eligibility_assessment_id
  and a.profile_id=auth.uid() and a.program_id=p.id and a.policy_version=p.policy_version
  and a.decision='eligible' and a.superseded_at is null) then
  raise exception 'current eligible assessment required' using errcode='23514';
 end if;
 if v.cohort_id is not null and not exists(select 1 from cohorts c where c.id=v.cohort_id and c.organization_id=p.organization_id) then
  raise exception 'cohort belongs to another organization' using errcode='23514';
 end if;
 if exists(select 1 from program_enrollments where program_id=p.id and profile_id=auth.uid() and status='enrolled') then
  raise exception 'already enrolled in program' using errcode='23514';
 end if;
 insert into program_enrollments(program_id,profile_id,seat_id,cohort_id,source)
 values(p.id,auth.uid(),v.id,v.cohort_id,'learner_acceptance') returning id into v_id;
 perform record_audit_event('funding.enrollment.accepted','program_enrollment',v_id::text,p.organization_id,
  null,null,jsonb_build_object('program_id',p.id,'seat_id',v.id,'cohort_id',v.cohort_id));
 return v_id;
end $$;
revoke all on function public.accept_funded_seat(uuid) from public,anon,service_role;
grant execute on function public.accept_funded_seat(uuid) to authenticated;

create function btg.guard_enrollment() returns trigger language plpgsql
security definer set search_path=public,btg,pg_temp as $$
begin
 if (new.program_id,new.profile_id,new.seat_id,new.cohort_id,new.enrolled_at,new.source)
  is distinct from (old.program_id,old.profile_id,old.seat_id,old.cohort_id,old.enrolled_at,old.source) then
  raise exception 'enrollment provenance is immutable' using errcode='23514';
 end if;
 if old.status='withdrawn' and new.status<>'withdrawn' then raise exception 'withdrawn enrollment cannot reopen' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function btg.guard_enrollment() from public,anon,authenticated,service_role;
create trigger enrollment_provenance before update on public.program_enrollments for each row execute function btg.guard_enrollment();

create function btg.synchronize_seat_enrollment() returns trigger language plpgsql
security definer set search_path=public,btg,pg_temp as $$
declare v_id uuid; v_program uuid; v_org uuid;
begin
 if new.status=old.status then return new; end if;
 if new.status in ('active','activated') and not exists(select 1 from program_enrollments e
  where e.seat_id=new.id and e.profile_id=new.profile_id and e.status='enrolled') then
  raise exception 'accept enrollment before activating the seat' using errcode='23514';
 end if;
 if new.status in ('released','expired','revoked') then
  update program_enrollments set status='withdrawn',withdrawn_at=now()
   where seat_id=new.id and status='enrolled' returning id,program_id into v_id,v_program;
  if v_id is not null then
   select organization_id into v_org from funding_programs where id=v_program;
   perform record_audit_event('funding.enrollment.withdrawn','program_enrollment',v_id::text,v_org,
    null,null,jsonb_build_object('seat_id',new.id,'seat_status',new.status));
  end if;
 end if;
 return new;
end $$;
revoke all on function btg.synchronize_seat_enrollment() from public,anon,authenticated,service_role;
create trigger seat_enrollment before update of status on public.funded_seats for each row execute function btg.synchronize_seat_enrollment();

-- Extend the same read model rather than create client-owned enrollment state.
drop function public.get_my_funded_seats();
create function public.get_my_funded_seats()
returns table(id uuid,status text,currency char(3),cost_minor bigint,activated_at timestamptz,reserved_until timestamptz,
 can_activate boolean,enrollment_id uuid,can_accept boolean)
language sql stable security invoker set search_path=public,btg,pg_temp as $$
 select s.id,s.status,s.currency,s.cost_minor,s.activated_at,s.reserved_until,
  s.status='allocated' and (s.reserved_until is null or s.reserved_until>now()) and e.id is not null,
  e.id,
  s.status='allocated' and (s.reserved_until is null or s.reserved_until>now()) and e.id is null
 from funded_seats s left join program_enrollments e on e.seat_id=s.id and e.status='enrolled'
 where s.profile_id=auth.uid() order by s.created_at desc,s.id;
$$;
revoke all on function public.get_my_funded_seats() from public,anon,service_role;
grant execute on function public.get_my_funded_seats() to authenticated;
