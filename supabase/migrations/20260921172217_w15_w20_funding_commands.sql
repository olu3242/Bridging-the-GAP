-- Transactional command boundary for W15-W20. Caller identity is always auth.uid().

create or replace function public.record_funding(
  p_program_id uuid,p_currency char(3),p_amount_minor bigint,p_idempotency_key text,
  p_provider text default null,p_provider_reference text default null,p_provider_confirmed boolean default false
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_id uuid; v_tx uuid; v_pool uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
  if p_amount_minor<=0 then raise exception 'amount must be positive' using errcode='23514'; end if;
  select id into v_id from funding_commitments where idempotency_key=p_idempotency_key;
  if found then return v_id; end if;
  insert into funding_commitments(program_id,sponsor_profile_id,currency,amount_minor,status,provider,provider_reference,idempotency_key,confirmed_at)
  values(p_program_id,auth.uid(),upper(p_currency),p_amount_minor,case when p_provider_confirmed then 'confirmed' else 'pending' end,
         p_provider,p_provider_reference,p_idempotency_key,case when p_provider_confirmed then now() end) returning id into v_id;
  if p_provider_confirmed then
    insert into funding_transactions(commitment_id,kind,currency,amount_minor,provider_reference,idempotency_key,provider_confirmed)
    values(v_id,'capture',upper(p_currency),p_amount_minor,p_provider_reference,p_idempotency_key||':capture',true) returning id into v_tx;
    select id into v_pool from funding_pools where program_id=p_program_id and cohort_id is null and currency=upper(p_currency) for update;
    if not found then insert into funding_pools(program_id,currency) values(p_program_id,upper(p_currency)) returning id into v_pool; end if;
    update funding_pools set funded_minor=funded_minor+p_amount_minor where id=v_pool;
    insert into funding_ledger(pool_id,transaction_id,kind,amount_minor,idempotency_key)
    values(v_pool,v_tx,'fund',p_amount_minor,p_idempotency_key||':ledger');
  end if;
  perform record_audit_event('funding.commitment.recorded','funding_commitment',v_id::text,null,'sponsor',null,
    jsonb_build_object('currency',upper(p_currency),'amount_minor',p_amount_minor,'confirmed',p_provider_confirmed),'notice',null,'w15');
  return v_id;
end $$;

create or replace function public.evaluate_eligibility(p_program_id uuid,p_evidence jsonb)
returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_id uuid; v_policy jsonb; v_version text; v_decision text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
  select eligibility_policy,policy_version into v_policy,v_version from funding_programs where id=p_program_id and status='active';
  if not found then raise exception 'program not found' using errcode='P0002'; end if;
  -- Deterministic policy: required evidence keys must be present. Human review handles richer rules.
  if coalesce(v_policy->'required_keys','[]') <@ coalesce((select jsonb_agg(key) from jsonb_object_keys(coalesce(p_evidence,'{}')) key),'[]')
    then v_decision:='eligible'; else v_decision:='review'; end if;
  update eligibility_assessments set superseded_at=now() where program_id=p_program_id and profile_id=auth.uid() and superseded_at is null;
  insert into eligibility_assessments(program_id,profile_id,policy_version,evidence,decision,rationale)
  values(p_program_id,auth.uid(),v_version,coalesce(p_evidence,'{}'),v_decision,jsonb_build_object('policy',v_policy)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.join_funding_waitlist(p_program_id uuid,p_assessment_id uuid)
returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_id uuid;
begin
  if not exists(select 1 from eligibility_assessments where id=p_assessment_id and program_id=p_program_id and profile_id=auth.uid() and decision='eligible' and superseded_at is null)
    then raise exception 'current eligible assessment required' using errcode='23514'; end if;
  insert into funding_waitlist(program_id,profile_id,assessment_id,status)
  values(p_program_id,auth.uid(),p_assessment_id,'waitlisted')
  on conflict(program_id,profile_id) do update set assessment_id=excluded.assessment_id,status='waitlisted',updated_at=now()
  returning id into v_id; return v_id;
end $$;

create or replace function public.allocate_funded_seat(p_waitlist_id uuid,p_pool_id uuid,p_cost_minor bigint,p_currency char(3),p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_wait funding_waitlist%rowtype; v_pool funding_pools%rowtype; v_seat uuid;
begin
  select * into v_wait from funding_waitlist where id=p_waitlist_id for update;
  if not found or v_wait.status not in ('waitlisted','matched','accepted') then raise exception 'waitlist entry unavailable' using errcode='23514'; end if;
  select * into v_pool from funding_pools where id=p_pool_id for update;
  if not found then raise exception 'pool not found' using errcode='P0002'; end if;
  if not (btg.is_operator() or exists(select 1 from funding_programs p where p.id=v_pool.program_id and btg.is_org_admin(p.organization_id)))
    then raise exception 'not authorized' using errcode='42501'; end if;
  if v_pool.currency<>upper(p_currency) or v_pool.funded_minor-v_pool.reserved_minor-v_pool.spent_minor<p_cost_minor
    then raise exception 'insufficient pool capacity' using errcode='23514'; end if;
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
  select * into v from funded_seats where id=p_seat_id for update;
  if not found or v.profile_id<>auth.uid() or v.status<>'allocated' then raise exception 'seat unavailable' using errcode='23514'; end if;
  update funded_seats set status='active',activated_at=now() where id=p_seat_id;
  update funding_pools set reserved_minor=reserved_minor-v.cost_minor,spent_minor=spent_minor+v.cost_minor where id=v.pool_id;
  insert into funding_ledger(pool_id,seat_id,kind,amount_minor,idempotency_key) values(v.pool_id,v.id,'activate',v.cost_minor,'seat:'||v.id||':activate');
  insert into impact_events(event_type,profile_id,program_id,source_type,source_id,idempotency_key,recorded_by)
    select 'learner_activated',v.profile_id,fp.program_id,'funded_seat',v.id,'seat:'||v.id||':activated',auth.uid() from funding_pools fp where fp.id=v.pool_id;
end $$;

create or replace function public.release_funded_seat(p_seat_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funded_seats%rowtype;
begin
  select * into v from funded_seats where id=p_seat_id for update;
  if not found then raise exception 'seat not found' using errcode='P0002'; end if;
  if not (btg.is_operator() or exists(select 1 from funding_pools fp join funding_programs p on p.id=fp.program_id where fp.id=v.pool_id and btg.is_org_admin(p.organization_id))) then raise exception 'not authorized' using errcode='42501'; end if;
  if v.status in ('allocated','reserved') then
    update funding_pools set reserved_minor=reserved_minor-v.cost_minor where id=v.pool_id;
  elsif v.status in ('activated','active') then
    update funding_pools set spent_minor=spent_minor-v.cost_minor where id=v.pool_id;
  else raise exception 'seat cannot be released from %',v.status using errcode='23514'; end if;
  update funded_seats set status='released',profile_id=null where id=v.id;
  insert into funding_ledger(pool_id,seat_id,kind,amount_minor,idempotency_key,metadata)
    values(v.pool_id,v.id,'release',-v.cost_minor,'seat:'||v.id||':release',jsonb_build_object('reason',p_reason));
end $$;

create or replace function public.claim_contribution_task(p_task_id uuid)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
  update contribution_tasks set assignee_id=auth.uid(),status='assigned',updated_at=now()
  where id=p_task_id and status='available' and assignee_id is null;
  if not found then raise exception 'task unavailable' using errcode='40001'; end if;
end $$;

create or replace function public.submit_contribution(p_task_id uuid,p_evidence_id uuid,p_provenance jsonb,p_content_hash text)
returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_id uuid;
begin
  if jsonb_typeof(p_provenance)<>'object' or not (p_provenance ?& array['source','method','captured_at','license_or_consent','version','transforms'])
    then raise exception 'complete provenance required' using errcode='23514'; end if;
  if not exists(select 1 from evidence where id=p_evidence_id and profile_id=auth.uid()) then raise exception 'evidence not found' using errcode='P0002'; end if;
  update contribution_tasks set status='submitted',updated_at=now() where id=p_task_id and assignee_id=auth.uid() and status in ('assigned','in_progress','revision_required');
  if not found then raise exception 'task unavailable' using errcode='23514'; end if;
  insert into contribution_submissions(task_id,contributor_id,evidence_id,provenance,content_hash)
  values(p_task_id,auth.uid(),p_evidence_id,p_provenance,p_content_hash) returning id into v_id; return v_id;
end $$;

create or replace function public.review_contribution(p_submission_id uuid,p_decision text,p_notes text default null)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v contribution_submissions%rowtype; v_org uuid;
begin
  if p_decision not in ('accepted','revision_required','rejected') then raise exception 'invalid decision' using errcode='23514'; end if;
  select s.* into v from contribution_submissions s where s.id=p_submission_id for update;
  select p.organization_id into v_org from contribution_submissions s join contribution_tasks t on t.id=s.task_id join contribution_programs p on p.id=t.program_id where s.id=p_submission_id;
  if not found or v.contributor_id=auth.uid() or not (btg.is_operator() or btg.is_org_admin(v_org) or btg.has_platform_persona('reviewer')) then raise exception 'not authorized' using errcode='42501'; end if;
  update contribution_submissions set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_notes=p_notes where id=p_submission_id;
  update contribution_tasks set status=p_decision,updated_at=now() where id=v.task_id;
  if p_decision='accepted' then
    insert into impact_events(event_type,profile_id,organization_id,source_type,source_id,evidence,idempotency_key,recorded_by)
    values('contribution_verified',v.contributor_id,v_org,'contribution_submission',v.id,jsonb_build_object('evidence_id',v.evidence_id),
      'contribution:'||v.id||':accepted',auth.uid()) on conflict(idempotency_key) do nothing;
  end if;
end $$;

create or replace function public.verify_placement(p_placement_id uuid,p_evidence_id uuid)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v placements%rowtype;
begin
  select * into v from placements where id=p_placement_id for update;
  if not found or v.profile_id=auth.uid() or not (btg.is_operator() or btg.is_org_admin(v.organization_id)) then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists(select 1 from evidence where id=p_evidence_id and status='accepted') then raise exception 'accepted evidence required' using errcode='23514'; end if;
  update placements set status='verified',evidence_id=p_evidence_id,verified_by=auth.uid(),verified_at=now() where id=v.id;
  insert into impact_events(event_type,profile_id,organization_id,source_type,source_id,evidence,idempotency_key,recorded_by)
  values('placement_verified',v.profile_id,v.organization_id,'placement',v.id,jsonb_build_object('evidence_id',p_evidence_id),'placement:'||v.id||':verified',auth.uid());
end $$;

create or replace function public.apply_to_challenge(p_challenge_id uuid)
returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_challenge challenges%rowtype; v_slug text; v_project projects; v_assignment uuid;
begin
  select * into v_challenge from challenges where id=p_challenge_id and status in ('published','accepting');
  if not found then raise exception 'challenge not found' using errcode='P0002'; end if;
  select slug into v_slug from project_briefs where id=v_challenge.project_brief_id;
  select * into v_project from assign_project(v_slug,null);
  insert into challenge_assignments(challenge_id,project_id,profile_id)
  values(v_challenge.id,v_project.id,auth.uid()) returning id into v_assignment;
  return v_assignment;
end $$;

create or replace function public.accept_challenge_solution(p_assignment_id uuid)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v challenge_assignments%rowtype; v_org uuid; v_evidence uuid;
begin
  select * into v from challenge_assignments where id=p_assignment_id for update;
  select cp.organization_id into v_org from challenges c join challenge_programs cp on cp.id=c.program_id where c.id=v.challenge_id;
  if not found or v.profile_id=auth.uid() or not (btg.is_operator() or btg.is_org_admin(v_org)) then raise exception 'not authorized' using errcode='42501'; end if;
  select e.id into v_evidence from evidence e join review_assignments r on r.evidence_id=e.id
    where e.project_id=v.project_id and e.status='accepted' and r.status='approved' order by e.version desc limit 1;
  if not found then raise exception 'independently accepted evidence required' using errcode='23514'; end if;
  update challenge_assignments set status='accepted' where id=v.id;
  update challenges set status='accepted' where id=v.challenge_id and status in ('submitted','evaluation','active','assigned','accepting');
  insert into impact_events(event_type,profile_id,organization_id,source_type,source_id,evidence,idempotency_key,recorded_by)
  values('solution_accepted',v.profile_id,v_org,'challenge_assignment',v.id,jsonb_build_object('evidence_id',v_evidence),
    'challenge-assignment:'||v.id||':accepted',auth.uid());
end $$;

create or replace function public.query_capability_graph(p_organization_id uuid default null,p_region text default null)
returns table(profile_id uuid,competency_id uuid,competency_name text,verified_level smallint,evidence_id uuid,verified_at timestamptz,freshness timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
  select vs.profile_id,vs.competency_id,c.name,vs.level,vs.evidence_id,vs.verified_at,greatest(vs.verified_at,e.submitted_at)
  from verified_skills vs join competencies c on c.id=vs.competency_id join evidence e on e.id=vs.evidence_id
  join profiles p on p.id=vs.profile_id
  where vs.revoked_at is null and vs.superseded_by is null
    and (p_region is null or p.country_code=p_region)
    and (p_organization_id is null or exists(select 1 from memberships m where m.organization_id=p_organization_id and m.profile_id=vs.profile_id and m.status='active'));
$$;

create or replace function public.get_evidence_path(p_profile_id uuid,p_competency_id uuid)
returns table(verified_skill_id uuid,evidence_id uuid,project_id uuid,credential_id uuid,verified_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select vs.id,vs.evidence_id,e.project_id,cs.credential_id,vs.verified_at
 from verified_skills vs join evidence e on e.id=vs.evidence_id
 left join credential_skills cs on cs.verified_skill_id=vs.id
 where vs.profile_id=p_profile_id and vs.competency_id=p_competency_id and vs.revoked_at is null;
$$;

create or replace function public.get_program_impact(p_program_id uuid)
returns table(event_type text,total bigint,first_at timestamptz,last_at timestamptz,freshness timestamptz)
language plpgsql security definer set search_path=public,btg,pg_temp as $$
begin
 if not exists(select 1 from funding_programs p where p.id=p_program_id and (btg.is_org_admin(p.organization_id) or btg.is_operator())) then raise exception 'program not found' using errcode='P0002'; end if;
 return query select i.event_type,count(*),min(i.occurred_at),max(i.occurred_at),now() from impact_events i where i.program_id=p_program_id group by i.event_type;
end $$;

-- Append-only ledgers and evidence-backed impact cannot be rewritten.
create trigger funding_ledger_append_only before update or delete on funding_ledger for each row execute function btg.reject_mutation();
create trigger impact_events_append_only before update or delete on impact_events for each row execute function btg.reject_mutation();

revoke all on function public.record_funding(uuid,char,bigint,text,text,text,boolean),public.evaluate_eligibility(uuid,jsonb),
 public.join_funding_waitlist(uuid,uuid),public.allocate_funded_seat(uuid,uuid,bigint,char,text),public.activate_funded_seat(uuid),
 public.release_funded_seat(uuid,text),public.claim_contribution_task(uuid),public.submit_contribution(uuid,uuid,jsonb,text),
 public.review_contribution(uuid,text,text),public.verify_placement(uuid,uuid),public.apply_to_challenge(uuid),public.accept_challenge_solution(uuid),public.query_capability_graph(uuid,text),
 public.get_evidence_path(uuid,uuid),public.get_program_impact(uuid) from public;
grant execute on function public.record_funding(uuid,char,bigint,text,text,text,boolean),public.evaluate_eligibility(uuid,jsonb),
 public.join_funding_waitlist(uuid,uuid),public.allocate_funded_seat(uuid,uuid,bigint,char,text),public.activate_funded_seat(uuid),
 public.release_funded_seat(uuid,text),public.claim_contribution_task(uuid),public.submit_contribution(uuid,uuid,jsonb,text),
 public.review_contribution(uuid,text,text),public.verify_placement(uuid,uuid),public.apply_to_challenge(uuid),public.accept_challenge_solution(uuid),public.query_capability_graph(uuid,text),
 public.get_evidence_path(uuid,uuid),public.get_program_impact(uuid) to authenticated,service_role;
