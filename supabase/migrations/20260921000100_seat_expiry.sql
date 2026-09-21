-- W21: governed expiry on the existing seat/ledger engine.
-- Existing undated allocations are retained for explicit operator release;
-- a new policy must not retroactively withdraw an existing learner offer.
alter table public.funding_programs add column reservation_duration_hours integer
 not null default 168 check (reservation_duration_hours between 1 and 2160);

create function public.configure_seat_expiry(p_program_id uuid,p_hours integer)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funding_programs%rowtype;
begin
 select * into v from funding_programs where id=p_program_id for update;
 if not found or auth.uid() is null or not (btg.is_operator() or btg.is_org_admin(v.organization_id)) then
  raise exception 'not authorized' using errcode='42501';
 end if;
 if p_hours is null or p_hours not between 1 and 2160 then raise exception 'expiry must be 1 to 2160 hours' using errcode='23514'; end if;
 if v.reservation_duration_hours=p_hours then return; end if;
 update funding_programs set reservation_duration_hours=p_hours where id=p_program_id;
 perform public.record_audit_event('funding.seat_policy.updated','funding_program',p_program_id::text,
  v.organization_id,null,jsonb_build_object('reservation_duration_hours',v.reservation_duration_hours),
  jsonb_build_object('reservation_duration_hours',p_hours));
end $$;

create function btg.set_seat_deadline() returns trigger language plpgsql
security definer set search_path=public,btg,pg_temp as $$
begin
 if new.status in ('allocated','reserved') then
  select now()+make_interval(hours=>p.reservation_duration_hours) into new.reserved_until
   from funding_pools f join funding_programs p on p.id=f.program_id where f.id=new.pool_id;
 end if;
 return new;
end $$;
revoke all on function btg.set_seat_deadline() from public,anon,authenticated,service_role;
create trigger seat_deadline before insert on public.funded_seats for each row execute function btg.set_seat_deadline();

create function public.expire_funded_seat(p_seat_id uuid) returns void
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funded_seats%rowtype;
begin
 -- Same pool mutex as allocation, activation and release: no seat/pool/waitlist
 -- lock inversion, and only one balance-changing transition can win.
 perform pg_advisory_xact_lock(hashtextextended('funding-pool:'||(select pool_id from funded_seats where id=p_seat_id),0));
 select * into v from funded_seats where id=p_seat_id for update;
 if not found or auth.uid() is null or not (btg.is_operator() or exists(
  select 1 from funding_pools f join funding_programs p on p.id=f.program_id
  where f.id=v.pool_id and btg.is_org_admin(p.organization_id))) then
  raise exception 'not authorized' using errcode='42501';
 end if;
 if v.status='expired' then return; end if;
 if v.status not in ('allocated','reserved') or v.reserved_until is null or v.reserved_until>now() then
  raise exception 'only overdue unconsumed seats may expire' using errcode='23514';
 end if;
 perform release_funded_seat(p_seat_id,'Reservation expired at '||v.reserved_until::text);
 update funded_seats set status='expired' where id=p_seat_id;
end $$;
revoke all on function public.configure_seat_expiry(uuid,integer),public.expire_funded_seat(uuid) from public,anon,service_role;
grant execute on function public.configure_seat_expiry(uuid,integer),public.expire_funded_seat(uuid) to authenticated;

create function public.get_expiring_seats(p_program_id uuid,p_after uuid default null,p_limit integer default 50)
returns table(id uuid,status text,reserved_until timestamptz,currency char(3),cost_minor bigint)
language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from funding_programs p where p.id=p_program_id
  and (btg.is_operator() or btg.is_org_admin(p.organization_id))) then
  raise exception 'not authorized' using errcode='42501';
 end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit must be 1 to 100' using errcode='23514'; end if;
 return query select s.id,s.status,s.reserved_until,s.currency,s.cost_minor from funded_seats s
 join funding_pools f on f.id=s.pool_id where f.program_id=p_program_id
 and s.status in ('allocated','reserved') and s.reserved_until<=now()
 and (p_after is null or s.id>p_after) order by s.id limit p_limit;
end $$;
revoke all on function public.get_expiring_seats(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.get_expiring_seats(uuid,uuid,integer) to authenticated;

-- A DB-clock read model for learner controls; the transition rechecks under lock.
create function public.get_my_funded_seats()
returns table(id uuid,status text,currency char(3),cost_minor bigint,activated_at timestamptz,reserved_until timestamptz,can_activate boolean)
language sql stable security invoker set search_path=public,btg,pg_temp as $$
 select s.id,s.status,s.currency,s.cost_minor,s.activated_at,s.reserved_until,
  s.status='allocated' and (s.reserved_until is null or s.reserved_until>now())
 from funded_seats s where s.profile_id=auth.uid() order by s.created_at desc,s.id;
$$;
revoke all on function public.get_my_funded_seats() from public,anon,service_role;
grant execute on function public.get_my_funded_seats() to authenticated;
