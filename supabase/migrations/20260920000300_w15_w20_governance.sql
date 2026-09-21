-- Organization/operator commands and aggregate intelligence. No authoritative table is client writable.

create or replace function public.create_funding_program(
 p_organization_id uuid,p_code text,p_name text,p_kind text,p_currency char(3),p_policy_version text,p_policy jsonb
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_id uuid;
begin
 if not btg.is_org_admin(p_organization_id) then raise exception 'not authorized' using errcode='42501'; end if;
 insert into funding_programs(organization_id,code,name,kind,currency,policy_version,eligibility_policy,status,created_by)
 values(p_organization_id,lower(p_code),p_name,p_kind,upper(p_currency),p_policy_version,coalesce(p_policy,'{}'),'active',auth.uid()) returning id into v_id;
 insert into funding_pools(program_id,currency) values(v_id,upper(p_currency));
 perform record_audit_event('funding.program.created','funding_program',v_id::text,p_organization_id,null,null,
  jsonb_build_object('code',lower(p_code),'policy_version',p_policy_version),'notice',null,'w15',p_policy_version);
 return v_id;
end $$;

create or replace function public.reconcile_funding(
 p_commitment_id uuid,p_provider_reference text,p_success boolean,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funding_commitments%rowtype; v_tx uuid; v_pool uuid;
begin
 select * into v from funding_commitments where id=p_commitment_id for update;
 if not found then raise exception 'commitment not found' using errcode='P0002'; end if;
 if not (btg.is_operator() or exists(select 1 from funding_programs p where p.id=v.program_id and btg.is_org_admin(p.organization_id))) then raise exception 'not authorized' using errcode='42501'; end if;
 select id into v_tx from funding_transactions where idempotency_key=p_idempotency_key;
 if found then return v_tx; end if;
 if v.status not in ('pending','failed') then raise exception 'commitment already reconciled' using errcode='23514'; end if;
 insert into funding_transactions(commitment_id,kind,currency,amount_minor,provider_reference,idempotency_key,provider_confirmed)
 values(v.id,case when p_success then 'capture' else 'failure' end,v.currency,v.amount_minor,p_provider_reference,p_idempotency_key,p_success) returning id into v_tx;
 update funding_commitments set status=case when p_success then 'confirmed' else 'failed' end,
  provider_reference=p_provider_reference,confirmed_at=case when p_success then now() end where id=v.id;
 if p_success then
  select id into v_pool from funding_pools where program_id=v.program_id and cohort_id is null and currency=v.currency for update;
  update funding_pools set funded_minor=funded_minor+v.amount_minor where id=v_pool;
  insert into funding_ledger(pool_id,transaction_id,kind,amount_minor,idempotency_key)
  values(v_pool,v_tx,'fund',v.amount_minor,p_idempotency_key||':ledger');
 end if;
 return v_tx;
end $$;

create or replace function public.create_contribution_task(
 p_program_id uuid,p_title text,p_instructions text,p_project_id uuid default null,p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_org uuid; v_id uuid;
begin
 select organization_id into v_org from contribution_programs where id=p_program_id and status='published';
 if not found or not btg.is_org_admin(v_org) then raise exception 'program not found' using errcode='P0002'; end if;
 insert into contribution_tasks(program_id,project_id,title,instructions,status,due_at)
 values(p_program_id,p_project_id,p_title,p_instructions,'available',p_due_at) returning id into v_id;
 return v_id;
end $$;

create or replace function public.create_contribution_program(
 p_organization_id uuid,p_name text,p_kind text,p_license text default null
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_id uuid;
begin
 if not btg.is_org_admin(p_organization_id) then raise exception 'not authorized' using errcode='42501'; end if;
 insert into contribution_programs(organization_id,name,kind,status,license)
 values(p_organization_id,p_name,p_kind,'published',p_license) returning id into v_id; return v_id;
end $$;

create or replace function public.record_earning(
 p_submission_id uuid,p_currency char(3),p_amount_minor bigint,p_rule_version text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_submission contribution_submissions%rowtype; v_org uuid; v_id uuid;
begin
 select * into v_submission from contribution_submissions where id=p_submission_id and status='accepted';
 select p.organization_id into v_org from contribution_submissions s join contribution_tasks t on t.id=s.task_id join contribution_programs p on p.id=t.program_id where s.id=p_submission_id;
 if not found or not (btg.is_operator() or btg.is_org_admin(v_org)) then raise exception 'accepted submission not found' using errcode='P0002'; end if;
 insert into earning_events(submission_id,profile_id,currency,amount_minor,rule_version,status,idempotency_key,approved_by)
 values(v_submission.id,v_submission.contributor_id,upper(p_currency),p_amount_minor,p_rule_version,'approved',p_idempotency_key,auth.uid())
 on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into v_id;
 return v_id;
end $$;

create or replace function public.create_challenge(
 p_organization_id uuid,p_program_name text,p_project_brief_id uuid,p_problem text,p_requirements jsonb,p_rights jsonb
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_program uuid; v_id uuid;
begin
 if not btg.is_org_admin(p_organization_id) then raise exception 'not authorized' using errcode='42501'; end if;
 if not exists(select 1 from project_briefs where id=p_project_brief_id and organization_id=p_organization_id and kind='challenge') then raise exception 'governed challenge brief required' using errcode='23514'; end if;
 insert into challenge_programs(organization_id,name,status) values(p_organization_id,p_program_name,'published') returning id into v_program;
 insert into challenges(program_id,project_brief_id,status,problem_statement,requirements,rights)
 values(v_program,p_project_brief_id,'accepting',p_problem,coalesce(p_requirements,'{}'),p_rights) returning id into v_id;
 return v_id;
end $$;

create or replace function public.create_placement(p_application_id uuid,p_started_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_app applications%rowtype; v_org uuid; v_id uuid;
begin
 select * into v_app from applications where id=p_application_id and status='accepted';
 select o.organization_id into v_org from opportunities o where o.id=v_app.opportunity_id;
 if not found or not btg.is_org_admin(v_org) then raise exception 'accepted application not found' using errcode='P0002'; end if;
 insert into placements(application_id,organization_id,profile_id,started_at)
 values(v_app.id,v_org,v_app.profile_id,p_started_at) returning id into v_id; return v_id;
end $$;

create or replace function public.get_institution_intelligence(p_organization_id uuid)
returns table(metric_key text,metric_value bigint,definition text,source_relations text[],scope jsonb,time_window tstzrange,freshness timestamptz)
language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v_members bigint;
begin
 if not btg.is_org_admin(p_organization_id) then raise exception 'organization not found' using errcode='P0002'; end if;
 select count(distinct profile_id) into v_members from memberships where organization_id=p_organization_id and status='active';
 if v_members<5 then raise exception 'at least 5 members required for aggregate intelligence' using errcode='23514'; end if;
 return query
 with facts(key,value,definition,sources) as (values
  ('active_learners',v_members,'Active organization members',array['memberships']),
  ('verified_skills',(select count(*) from verified_skills vs where vs.revoked_at is null and exists(select 1 from memberships m where m.organization_id=p_organization_id and m.profile_id=vs.profile_id and m.status='active')),'Live verified skill claims',array['verified_skills','memberships']),
  ('verified_placements',(select count(*) from placements p where p.organization_id=p_organization_id and p.status='verified'),'Evidence-verified placements',array['placements','evidence']),
  ('accepted_contributions',(select count(*) from contribution_submissions s join contribution_tasks t on t.id=s.task_id join contribution_programs cp on cp.id=t.program_id where cp.organization_id=p_organization_id and s.status='accepted'),'Independently accepted contributions',array['contribution_submissions','contribution_tasks'])
 ) select f.key,f.value,f.definition,f.sources,jsonb_build_object('organization_id',p_organization_id),tstzrange('-infinity',now(),'[]'),now() from facts f;
end $$;

revoke all on function public.create_funding_program(uuid,text,text,text,char,text,jsonb),public.reconcile_funding(uuid,text,boolean,text),
 public.create_contribution_program(uuid,text,text,text),public.create_contribution_task(uuid,text,text,uuid,timestamptz),
 public.record_earning(uuid,char,bigint,text,text),public.create_challenge(uuid,text,uuid,text,jsonb,jsonb),
 public.create_placement(uuid,timestamptz),public.get_institution_intelligence(uuid) from public;
grant execute on function public.create_funding_program(uuid,text,text,text,char,text,jsonb),public.reconcile_funding(uuid,text,boolean,text),
 public.create_contribution_program(uuid,text,text,text),public.create_contribution_task(uuid,text,text,uuid,timestamptz),
 public.record_earning(uuid,char,bigint,text,text),public.create_challenge(uuid,text,uuid,text,jsonb,jsonb),
 public.create_placement(uuid,timestamptz),public.get_institution_intelligence(uuid) to authenticated,service_role;
