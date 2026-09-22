-- Harden existing W15 seat allocation; do not introduce another seat engine.
create or replace function public.allocate_funded_seat(p_waitlist_id uuid,p_pool_id uuid,p_cost_minor bigint,p_currency char(3),p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_wait funding_waitlist%rowtype; v_pool funding_pools%rowtype; v_previous funded_seats%rowtype; v_seat uuid;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 if p_cost_minor is null or p_cost_minor<=0 or nullif(btrim(p_idempotency_key),'') is null then
  raise exception 'positive cost and idempotency key required' using errcode='23514';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('allocate:'||p_idempotency_key,0));
 perform pg_advisory_xact_lock(hashtextextended('funding-pool:'||p_pool_id,0));
 select * into v_wait from funding_waitlist where id=p_waitlist_id for update;
 if not found then raise exception 'waitlist entry unavailable' using errcode='23514'; end if;
 select * into v_pool from funding_pools where id=p_pool_id for update;
 if not found then raise exception 'pool not found' using errcode='P0002'; end if;
 if not (btg.is_operator() or exists(select 1 from funding_programs p where p.id=v_pool.program_id and btg.is_org_admin(p.organization_id)))
  or v_wait.profile_id=auth.uid() then raise exception 'independent authorized allocator required' using errcode='42501'; end if;
 if v_wait.program_id<>v_pool.program_id then raise exception 'program mismatch' using errcode='23514'; end if;
 select s.* into v_previous from funding_ledger l join funded_seats s on s.id=l.seat_id where l.idempotency_key=p_idempotency_key;
 if found then
  if v_previous.pool_id<>p_pool_id or v_previous.profile_id is distinct from v_wait.profile_id
   or v_previous.cost_minor<>p_cost_minor or v_previous.currency is distinct from upper(p_currency)
   or v_wait.offered_seat_id is distinct from v_previous.id then raise exception 'idempotency conflict' using errcode='23514'; end if;
  return v_previous.id;
 end if;
 if v_wait.status not in ('waitlisted','matched','accepted') then raise exception 'waitlist entry unavailable' using errcode='23514'; end if;
 if not exists(select 1 from eligibility_assessments a join funding_programs p on p.id=a.program_id
  where a.id=v_wait.assessment_id and a.profile_id=v_wait.profile_id and a.program_id=v_pool.program_id
   and a.decision='eligible' and a.superseded_at is null and a.policy_version=p.policy_version and p.status='active') then
  raise exception 'current eligible assessment required' using errcode='23514';
 end if;
 if v_pool.currency is distinct from upper(p_currency) or v_pool.funded_minor-v_pool.reserved_minor-v_pool.spent_minor<p_cost_minor then
  raise exception 'insufficient pool capacity' using errcode='23514';
 end if;
 if exists(select 1 from funded_seats s where s.pool_id=p_pool_id and s.profile_id=v_wait.profile_id
  and s.status in ('reserved','allocated','activated','active')) then raise exception 'learner already holds a live seat' using errcode='23514'; end if;
 insert into funded_seats(pool_id,cohort_id,profile_id,eligibility_assessment_id,cost_minor,currency,status,allocated_at)
 values(p_pool_id,v_pool.cohort_id,v_wait.profile_id,v_wait.assessment_id,p_cost_minor,upper(p_currency),'allocated',now()) returning id into v_seat;
 update funding_pools set reserved_minor=reserved_minor+p_cost_minor where id=p_pool_id;
 insert into funding_ledger(pool_id,seat_id,kind,amount_minor,idempotency_key) values(p_pool_id,v_seat,'reserve',p_cost_minor,p_idempotency_key);
 update funding_waitlist set status='allocated',offered_seat_id=v_seat,updated_at=now() where id=p_waitlist_id;
 return v_seat;
end $$;

create or replace function public.activate_funded_seat(p_seat_id uuid)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funded_seats%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('funding-pool:'||(select pool_id from funded_seats where id=p_seat_id),0));
 select * into v from funded_seats where id=p_seat_id for update;
 if not found or auth.uid() is null or v.profile_id is distinct from auth.uid() then raise exception 'seat unavailable' using errcode='23514'; end if;
 if v.status in ('active','activated') then return; end if;
 if v.status<>'allocated' or (v.reserved_until is not null and v.reserved_until<=now()) then raise exception 'seat unavailable' using errcode='23514'; end if;
 update funded_seats set status='active',activated_at=now() where id=p_seat_id;
 update funding_pools set reserved_minor=reserved_minor-v.cost_minor,spent_minor=spent_minor+v.cost_minor where id=v.pool_id;
 insert into funding_ledger(pool_id,seat_id,kind,amount_minor,idempotency_key) values(v.pool_id,v.id,'activate',v.cost_minor,'seat:'||v.id||':activate');
 update funding_waitlist set status='activated',updated_at=now() where offered_seat_id=v.id;
 insert into impact_events(event_type,profile_id,program_id,source_type,source_id,idempotency_key,recorded_by)
 select 'learner_activated',v.profile_id,fp.program_id,'funded_seat',v.id,'seat:'||v.id||':activated',auth.uid() from funding_pools fp where fp.id=v.pool_id;
end $$;

-- Releasing an unused reservation restores capacity. Consumed learning funding
-- requires a separate governed refund; it must never silently become spendable.
create or replace function public.release_funded_seat(p_seat_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funded_seats%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('funding-pool:'||(select pool_id from funded_seats where id=p_seat_id),0));
 select * into v from funded_seats where id=p_seat_id for update;
 if not found then raise exception 'seat not found' using errcode='P0002'; end if;
 if not (btg.is_operator() or exists(select 1 from funding_pools fp join funding_programs p on p.id=fp.program_id where fp.id=v.pool_id and btg.is_org_admin(p.organization_id))) then raise exception 'not authorized' using errcode='42501'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'release reason required' using errcode='23514'; end if;
 if v.status='released' then return; end if;
 if v.status not in ('allocated','reserved') then raise exception 'only unconsumed seats may be released' using errcode='23514'; end if;
 update funding_pools set reserved_minor=reserved_minor-v.cost_minor where id=v.pool_id;
 update funded_seats set status='released' where id=v.id;
 update funding_waitlist set status='waitlisted',offered_seat_id=null,offer_expires_at=null,updated_at=now() where offered_seat_id=v.id;
 insert into funding_ledger(pool_id,seat_id,kind,amount_minor,idempotency_key,metadata)
 values(v.pool_id,v.id,'release',-v.cost_minor,'seat:'||v.id||':release',jsonb_build_object('reason',p_reason,'profile_id',v.profile_id,'actor_id',auth.uid()));
end $$;
