-- Certification corrections. Preserve the applied W15-W20 migration history.
insert into btg.workflow_taxonomy(label) values('w15') on conflict do nothing;
insert into public.workflow_definitions(key,name,description,scope,audit_workflow,is_enabled)
values('w15','Funding access','Audit namespace for canonical funding commands; orchestration is not yet enabled.','organization','w15',false)
on conflict(key) do nothing;
-- Never let a session's boolean assertion stand in for payment-provider evidence.
create or replace function public.record_funding(
 p_program_id uuid,p_currency char(3),p_amount_minor bigint,p_idempotency_key text,
 p_provider text default null,p_provider_reference text default null,p_provider_confirmed boolean default false
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funding_commitments%rowtype;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 if p_provider_confirmed or p_provider_reference is not null then
  raise exception 'provider confirmation requires governed reconciliation' using errcode='42501';
 end if;
 if p_amount_minor is null or p_amount_minor<=0 or nullif(btrim(p_idempotency_key),'') is null then
  raise exception 'positive amount and idempotency key required' using errcode='23514';
 end if;
 if not exists(select 1 from funding_programs where id=p_program_id and status='active' and currency=upper(p_currency)) then
  raise exception 'active program and matching currency required' using errcode='23514';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('funding:'||p_idempotency_key,0));
 select * into v from funding_commitments where idempotency_key=p_idempotency_key;
 if found then
  if v.sponsor_profile_id is distinct from auth.uid() or v.program_id is distinct from p_program_id
   or v.currency is distinct from upper(p_currency) or v.amount_minor is distinct from p_amount_minor
   or v.provider is distinct from p_provider then
   raise exception 'idempotency conflict' using errcode='23514';
  end if;
  return v.id;
 end if;
 insert into funding_commitments(program_id,sponsor_profile_id,currency,amount_minor,provider,idempotency_key)
 values(p_program_id,auth.uid(),upper(p_currency),p_amount_minor,p_provider,p_idempotency_key) returning * into v;
 perform record_audit_event('funding.commitment.recorded','funding_commitment',v.id::text,null,'sponsor',null,
  jsonb_build_object('currency',v.currency,'amount_minor',v.amount_minor,'confirmed',false),'notice',null,'w15');
 return v.id;
end $$;

-- Explicit operator reconciliation is the governed manual path. Organization
-- administrators may fund programs but cannot certify their own settlement.
create or replace function public.reconcile_funding(
 p_commitment_id uuid,p_provider_reference text,p_success boolean,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v funding_commitments%rowtype; v_tx funding_transactions%rowtype; v_pool uuid;
begin
 if not btg.is_operator() then raise exception 'payment reconciliation operator required' using errcode='42501'; end if;
 if p_success is null or nullif(btrim(p_provider_reference),'') is null or nullif(btrim(p_idempotency_key),'') is null then
  raise exception 'provider reference, result and idempotency key required' using errcode='23514';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reconcile:'||p_idempotency_key,0));
 select * into v from funding_commitments where id=p_commitment_id for update;
 if not found then raise exception 'commitment not found' using errcode='P0002'; end if;
 if nullif(btrim(v.provider),'') is null then raise exception 'payment provider required' using errcode='23514'; end if;
 select * into v_tx from funding_transactions where idempotency_key=p_idempotency_key;
 if found then
  if v_tx.commitment_id<>v.id or v_tx.provider_reference is distinct from p_provider_reference
   or v_tx.provider_confirmed is distinct from p_success then raise exception 'idempotency conflict' using errcode='23514'; end if;
  return v_tx.id;
 end if;
 if v.status not in ('pending','failed') then raise exception 'commitment already reconciled' using errcode='23514'; end if;
 select id into v_pool from funding_pools where program_id=v.program_id and cohort_id is null and currency=v.currency for update;
 if not found then raise exception 'matching funding pool required' using errcode='23514'; end if;
 insert into funding_transactions(commitment_id,kind,currency,amount_minor,provider_reference,idempotency_key,provider_confirmed,metadata)
 values(v.id,case when p_success then 'capture' else 'failure' end,v.currency,v.amount_minor,p_provider_reference,p_idempotency_key,p_success,
  jsonb_build_object('reconciled_by',auth.uid(),'provider',v.provider,'path','operator_reconciliation')) returning * into v_tx;
 update funding_commitments set status=case when p_success then 'confirmed' else 'failed' end,
  provider_reference=p_provider_reference,confirmed_at=case when p_success then now() end where id=v.id;
 if p_success then
  update funding_pools set funded_minor=funded_minor+v.amount_minor where id=v_pool;
  insert into funding_ledger(pool_id,transaction_id,kind,amount_minor,idempotency_key)
  values(v_pool,v_tx.id,'fund',v.amount_minor,'transaction:'||v_tx.id||':fund');
 end if;
 perform record_audit_event('funding.reconciled','funding_commitment',v.id::text,null,null,null,
  jsonb_build_object('transaction_id',v_tx.id,'provider_reference',p_provider_reference,'confirmed',p_success),'notice',null,'w15');
 return v_tx.id;
end $$;

create trigger funding_transactions_append_only before update or delete on public.funding_transactions
 for each row execute function btg.reject_mutation();

create or replace function public.review_contribution(p_submission_id uuid,p_decision text,p_notes text default null)
returns void language plpgsql security definer set search_path=public,btg,pg_temp as $$
declare v contribution_submissions%rowtype; v_org uuid;
begin
 if p_decision is null or p_decision not in ('accepted','revision_required','rejected') then raise exception 'invalid decision' using errcode='23514'; end if;
 select * into v from contribution_submissions where id=p_submission_id for update;
 if not found then raise exception 'submission not found' using errcode='P0002'; end if;
 select p.organization_id into v_org from contribution_tasks t join contribution_programs p on p.id=t.program_id where t.id=v.task_id;
 if auth.uid() is null or v.contributor_id=auth.uid() or not (btg.is_operator() or btg.is_org_admin(v_org)) then
  raise exception 'independent authorized reviewer required' using errcode='42501';
 end if;
 if v.status not in ('submitted','review') then
  if v.status=p_decision and v.reviewed_by=auth.uid() and v.review_notes is not distinct from p_notes then return; end if;
  raise exception 'contribution already reviewed' using errcode='23514';
 end if;
 update contribution_submissions set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_notes=p_notes where id=v.id;
 update contribution_tasks set status=p_decision,updated_at=now() where id=v.task_id;
 if p_decision='accepted' then
  insert into impact_events(event_type,profile_id,organization_id,source_type,source_id,evidence,idempotency_key,recorded_by)
  values('contribution_verified',v.contributor_id,v_org,'contribution_submission',v.id,jsonb_build_object('evidence_id',v.evidence_id),
   'contribution:'||v.id||':accepted',auth.uid());
 end if;
end $$;

create function btg.guard_contribution_provenance() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if new.task_id is distinct from old.task_id or new.contributor_id is distinct from old.contributor_id
  or new.evidence_id is distinct from old.evidence_id or new.provenance is distinct from old.provenance
  or new.content_hash is distinct from old.content_hash or new.submitted_at is distinct from old.submitted_at then
  raise exception 'submission provenance is immutable' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function btg.guard_contribution_provenance() from public,anon,authenticated;
create trigger contribution_provenance_immutable before update on public.contribution_submissions
 for each row execute function btg.guard_contribution_provenance();

-- W15's broad grant accidentally restored write privileges on existing views.
do $$ declare v record; begin
 for v in select schemaname,viewname from pg_views where schemaname='public' loop
  execute format('revoke insert,update,delete,truncate,references,trigger on %I.%I from service_role',v.schemaname,v.viewname);
 end loop;
end $$;
