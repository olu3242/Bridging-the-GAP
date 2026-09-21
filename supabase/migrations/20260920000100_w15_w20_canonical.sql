-- W15-W20: canonical access, contribution, talent, challenge and intelligence records.
-- W20 is deliberately a projection over these records; it owns no truth.

create table public.regional_markets (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  name text not null, country_codes text[] not null default '{}', currencies text[] not null,
  active boolean not null default true, configuration jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.access_plans (
  id uuid primary key default gen_random_uuid(), market_id uuid references public.regional_markets,
  code text not null, name text not null, currency char(3) not null,
  amount_minor bigint not null check(amount_minor>=0), interval text not null check(interval in ('once','month','year')),
  active boolean not null default true, configuration jsonb not null default '{}', unique(market_id,code)
);
create table public.funding_programs (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations,
  code text not null unique, name text not null, kind text not null check(kind in ('fund_a_seat','cohort','community','program')),
  currency char(3) not null, policy_version text not null, eligibility_policy jsonb not null default '{}',
  status text not null default 'draft' check(status in ('draft','active','paused','closed')),
  created_by uuid references public.profiles, created_at timestamptz not null default now()
);
create table public.funding_commitments (
  id uuid primary key default gen_random_uuid(), program_id uuid references public.funding_programs,
  sponsor_profile_id uuid references public.profiles, sponsor_organization_id uuid references public.organizations,
  plan_id uuid references public.access_plans, currency char(3) not null,
  amount_minor bigint not null check(amount_minor>0), status text not null default 'pending'
    check(status in ('pending','confirmed','failed','expired','refunded','partially_refunded')),
  provider text, provider_reference text, idempotency_key text not null unique,
  created_at timestamptz not null default now(), confirmed_at timestamptz,
  check(num_nonnulls(sponsor_profile_id,sponsor_organization_id)>=1),
  unique(provider,provider_reference)
);
create table public.funding_transactions (
  id uuid primary key default gen_random_uuid(), commitment_id uuid not null references public.funding_commitments,
  kind text not null check(kind in ('authorization','capture','failure','refund','reversal','reconciliation')),
  currency char(3) not null, amount_minor bigint not null check(amount_minor>0),
  provider_reference text, idempotency_key text not null unique, provider_confirmed boolean not null default false,
  occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'
);
create table public.funding_pools (
  id uuid primary key default gen_random_uuid(), program_id uuid not null references public.funding_programs,
  cohort_id uuid references public.cohorts, currency char(3) not null,
  funded_minor bigint not null default 0 check(funded_minor>=0),
  reserved_minor bigint not null default 0 check(reserved_minor>=0),
  spent_minor bigint not null default 0 check(spent_minor>=0),
  check(reserved_minor+spent_minor<=funded_minor), unique(program_id,cohort_id,currency)
);
create unique index funding_pools_scope_unique on public.funding_pools(program_id,coalesce(cohort_id,'00000000-0000-0000-0000-000000000000'::uuid),currency);
create table public.funding_ledger (
  id uuid primary key default gen_random_uuid(), pool_id uuid not null references public.funding_pools,
  transaction_id uuid references public.funding_transactions, seat_id uuid,
  kind text not null check(kind in ('fund','reserve','release','activate','refund','reversal','adjustment')),
  amount_minor bigint not null check(amount_minor<>0), idempotency_key text not null unique,
  created_at timestamptz not null default now(), metadata jsonb not null default '{}'
);
create table public.eligibility_assessments (
  id uuid primary key default gen_random_uuid(), program_id uuid not null references public.funding_programs,
  profile_id uuid not null references public.profiles, policy_version text not null,
  evidence jsonb not null default '{}', decision text not null check(decision in ('eligible','ineligible','review')),
  rationale jsonb not null default '{}', assessed_by uuid references public.profiles,
  assessed_at timestamptz not null default now(), superseded_at timestamptz
);
create unique index eligibility_current on public.eligibility_assessments(program_id,profile_id) where superseded_at is null;
create table public.funded_seats (
  id uuid primary key default gen_random_uuid(), pool_id uuid not null references public.funding_pools,
  cohort_id uuid references public.cohorts, profile_id uuid references public.profiles,
  eligibility_assessment_id uuid references public.eligibility_assessments,
  cost_minor bigint not null check(cost_minor>0), currency char(3) not null,
  status text not null default 'available' check(status in ('available','reserved','allocated','activated','active','completed','expired','revoked','released','reallocated')),
  reserved_until timestamptz, allocated_at timestamptz, activated_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.funding_ledger add constraint funding_ledger_seat_fk foreign key(seat_id) references public.funded_seats;
create unique index one_live_sponsorship on public.funded_seats(profile_id,cohort_id)
  where profile_id is not null and status in ('reserved','allocated','activated','active');
create table public.funding_waitlist (
  id uuid primary key default gen_random_uuid(), program_id uuid not null references public.funding_programs,
  profile_id uuid not null references public.profiles, assessment_id uuid not null references public.eligibility_assessments,
  status text not null default 'eligible' check(status in ('eligible','waitlisted','matched','offered','accepted','allocated','activated','declined','expired')),
  offered_seat_id uuid references public.funded_seats, offer_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(program_id,profile_id)
);

create table public.contribution_programs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  name text not null, kind text not null check(kind in ('data','research','localization','evaluation','digitization','community','solution')),
  status text not null default 'draft' check(status in ('draft','published','closed')),
  license text, consent_requirements jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.contribution_tasks (
  id uuid primary key default gen_random_uuid(), program_id uuid not null references public.contribution_programs,
  project_id uuid references public.projects, title text not null, instructions text not null,
  status text not null default 'draft' check(status in ('draft','published','available','assigned','in_progress','submitted','review','accepted','revision_required','rejected','cancelled','expired')),
  assignee_id uuid references public.profiles, due_at timestamptz, version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.contribution_submissions (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.contribution_tasks,
  contributor_id uuid not null references public.profiles, evidence_id uuid references public.evidence,
  status text not null default 'submitted' check(status in ('submitted','review','accepted','revision_required','rejected')),
  provenance jsonb not null, content_hash text not null, submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles, reviewed_at timestamptz, review_notes text,
  unique(task_id,contributor_id,content_hash), check(reviewed_by is null or reviewed_by<>contributor_id)
);
create table public.datasets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  name text not null, license text not null, visibility text not null check(visibility in ('restricted','organization','public')),
  created_at timestamptz not null default now()
);
create table public.dataset_versions (
  id uuid primary key default gen_random_uuid(), dataset_id uuid not null references public.datasets,
  version integer not null check(version>0), source_submission_id uuid references public.contribution_submissions,
  provenance jsonb not null, content_hash text not null, verified_by uuid references public.profiles,
  created_at timestamptz not null default now(), unique(dataset_id,version), unique(dataset_id,content_hash)
);
create table public.research_projects (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  title text not null, license text, status text not null default 'draft' check(status in ('draft','active','review','verified','closed')),
  created_at timestamptz not null default now()
);
create table public.research_contributions (
  id uuid primary key default gen_random_uuid(), research_project_id uuid not null references public.research_projects,
  submission_id uuid not null unique references public.contribution_submissions, contribution_type text not null,
  verified_at timestamptz
);
create table public.earning_events (
  id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.contribution_submissions,
  profile_id uuid not null references public.profiles, currency char(3) not null, amount_minor bigint not null check(amount_minor>0),
  rule_version text not null, status text not null default 'pending' check(status in ('pending','approved','payable','paid','reversed','cancelled')),
  payment_reference text, idempotency_key text not null unique, approved_by uuid references public.profiles,
  created_at timestamptz not null default now(), unique(submission_id,rule_version)
);

create table public.talent_profiles (
  profile_id uuid primary key references public.profiles, availability text, languages text[] not null default '{}',
  timezone text not null default 'UTC', updated_at timestamptz not null default now()
);
create table public.placements (
  id uuid primary key default gen_random_uuid(), application_id uuid not null unique references public.applications,
  organization_id uuid not null references public.organizations, profile_id uuid not null references public.profiles,
  status text not null default 'pending_verification' check(status in ('pending_verification','verified','rejected','ended')),
  evidence_id uuid references public.evidence, verified_by uuid references public.profiles,
  started_at timestamptz, verified_at timestamptz, check(verified_by is null or verified_by<>profile_id),
  check(status<>'verified' or (evidence_id is not null and verified_by is not null and verified_at is not null))
);

create table public.challenge_programs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  name text not null, status text not null default 'draft' check(status in ('draft','published','closed')),
  confidentiality text not null default 'organization', license text, created_at timestamptz not null default now()
);
create table public.challenges (
  id uuid primary key default gen_random_uuid(), program_id uuid not null references public.challenge_programs,
  project_brief_id uuid not null unique references public.project_briefs,
  status text not null default 'draft' check(status in ('draft','review','published','accepting','assigned','active','submitted','evaluation','accepted','completed','revision','rejected','cancelled','expired')),
  problem_statement text not null, requirements jsonb not null default '{}', eligibility_policy jsonb not null default '{}',
  rights jsonb not null, created_at timestamptz not null default now()
);
create table public.challenge_assignments (
  id uuid primary key default gen_random_uuid(), challenge_id uuid not null references public.challenges,
  project_id uuid not null unique references public.projects, profile_id uuid not null references public.profiles,
  status text not null default 'assigned' check(status in ('assigned','active','submitted','evaluation','accepted','revision','rejected','completed')),
  unique(challenge_id,profile_id)
);

create table public.impact_events (
  id uuid primary key default gen_random_uuid(), event_type text not null,
  profile_id uuid references public.profiles, organization_id uuid references public.organizations,
  program_id uuid, source_type text not null, source_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(), evidence jsonb not null default '{}',
  idempotency_key text not null unique, recorded_by uuid not null references public.profiles
);
create table public.metric_definitions (
  key text primary key, name text not null, definition text not null, source_relations text[] not null,
  minimum_group_size integer not null default 5 check(minimum_group_size>=1), active boolean not null default true
);

-- All public truth remains tenant-scoped. Mutations happen through commands.
do $$ declare t text; begin
  foreach t in array array[
    'regional_markets','access_plans','funding_programs','funding_commitments','funding_transactions','funding_pools','funding_ledger',
    'eligibility_assessments','funded_seats','funding_waitlist','contribution_programs','contribution_tasks','contribution_submissions',
    'datasets','dataset_versions','research_projects','research_contributions','earning_events','talent_profiles','placements',
    'challenge_programs','challenges','challenge_assignments','impact_events','metric_definitions'
  ] loop execute format('alter table public.%I enable row level security',t); end loop;
end $$;

-- Configuration is readable; sensitive financial and intelligence records are not globally visible.
create policy markets_read on public.regional_markets for select to authenticated using(active or btg.is_operator());
create policy plans_read on public.access_plans for select to authenticated using(active or btg.is_operator());
create policy programs_read on public.funding_programs for select to authenticated using(status='active' or btg.is_org_admin(organization_id));
create policy commitments_read on public.funding_commitments for select to authenticated using(sponsor_profile_id=auth.uid() or btg.is_org_admin(sponsor_organization_id) or btg.is_operator());
create policy transactions_read on public.funding_transactions for select to authenticated using(exists(select 1 from public.funding_commitments c where c.id=commitment_id and (c.sponsor_profile_id=auth.uid() or btg.is_org_admin(c.sponsor_organization_id))) or btg.is_operator());
create policy pools_read on public.funding_pools for select to authenticated using(exists(select 1 from public.funding_programs p where p.id=program_id and btg.is_org_admin(p.organization_id)) or btg.is_operator());
create policy ledger_read on public.funding_ledger for select to authenticated using(exists(select 1 from public.funding_pools fp join public.funding_programs p on p.id=fp.program_id where fp.id=pool_id and btg.is_org_admin(p.organization_id)) or btg.is_operator());
create policy assessment_read on public.eligibility_assessments for select to authenticated using(profile_id=auth.uid() or exists(select 1 from public.funding_programs p where p.id=program_id and btg.is_org_admin(p.organization_id)) or btg.is_operator());
create policy seats_read on public.funded_seats for select to authenticated using(profile_id=auth.uid() or exists(select 1 from public.funding_pools fp join public.funding_programs p on p.id=fp.program_id where fp.id=pool_id and btg.is_org_admin(p.organization_id)) or btg.is_operator());
create policy waitlist_read on public.funding_waitlist for select to authenticated using(profile_id=auth.uid() or exists(select 1 from public.funding_programs p where p.id=program_id and btg.is_org_admin(p.organization_id)) or btg.is_operator());
create policy contribution_program_read on public.contribution_programs for select to authenticated using(status='published' or btg.is_org_admin(organization_id));
create policy contribution_task_read on public.contribution_tasks for select to authenticated using(assignee_id=auth.uid() or status in ('published','available') or exists(select 1 from public.contribution_programs p where p.id=program_id and btg.is_org_admin(p.organization_id)));
create policy contribution_submission_read on public.contribution_submissions for select to authenticated using(contributor_id=auth.uid() or exists(select 1 from public.contribution_tasks t join public.contribution_programs p on p.id=t.program_id where t.id=task_id and btg.is_org_admin(p.organization_id)) or btg.is_operator());
create policy dataset_read on public.datasets for select to authenticated using(visibility='public' or btg.is_active_member(organization_id) or btg.is_operator());
create policy dataset_version_read on public.dataset_versions for select to authenticated using(exists(select 1 from public.datasets d where d.id=dataset_id));
create policy research_read on public.research_projects for select to authenticated using(btg.is_active_member(organization_id) or btg.is_operator());
create policy research_contribution_read on public.research_contributions for select to authenticated using(exists(select 1 from public.research_projects r where r.id=research_project_id));
create policy earning_read on public.earning_events for select to authenticated using(profile_id=auth.uid() or btg.is_operator());
create policy talent_read on public.talent_profiles for select to authenticated using(profile_id=auth.uid() or btg.is_operator() or exists(select 1 from public.applications a join public.opportunities o on o.id=a.opportunity_id where a.profile_id=talent_profiles.profile_id and btg.is_org_admin(o.organization_id)));
create policy placement_read on public.placements for select to authenticated using(profile_id=auth.uid() or btg.is_org_admin(organization_id) or btg.is_operator());
create policy challenge_program_read on public.challenge_programs for select to authenticated using(status='published' or btg.is_org_admin(organization_id));
create policy challenge_read on public.challenges for select to authenticated using(status in ('published','accepting') or exists(select 1 from public.challenge_programs p where p.id=program_id and btg.is_org_admin(p.organization_id)));
create policy challenge_assignment_read on public.challenge_assignments for select to authenticated using(profile_id=auth.uid() or exists(select 1 from public.challenges c join public.challenge_programs p on p.id=c.program_id where c.id=challenge_id and btg.is_org_admin(p.organization_id)));
create policy impact_read on public.impact_events for select to authenticated using(profile_id=auth.uid() or btg.is_org_admin(organization_id) or btg.is_operator());
create policy metric_definition_read on public.metric_definitions for select to authenticated using(active or btg.is_operator());

-- W15-W20 tables are read-only from PostgREST; commands below own every mutation.
grant select on public.regional_markets,public.access_plans,public.funding_programs,public.funding_commitments,public.funding_transactions,
 public.funding_pools,public.funding_ledger,public.eligibility_assessments,public.funded_seats,public.funding_waitlist,
 public.contribution_programs,public.contribution_tasks,public.contribution_submissions,public.datasets,public.dataset_versions,
 public.research_projects,public.research_contributions,public.earning_events,public.talent_profiles,public.placements,
 public.challenge_programs,public.challenges,public.challenge_assignments,public.impact_events,public.metric_definitions to authenticated;
grant all on all tables in schema public to service_role;

create index funded_seats_pool_status on public.funded_seats(pool_id,status);
create index funding_waitlist_match on public.funding_waitlist(program_id,status,created_at);
create index contribution_tasks_available on public.contribution_tasks(status) where status='available';
create index contribution_submissions_review on public.contribution_submissions(status,submitted_at);
create index impact_events_source on public.impact_events(source_type,source_id);
create index impact_events_program on public.impact_events(program_id,event_type,occurred_at);
