-- W02 Batch A — E3 Diagnostic Engine.
-- Catalogue, question bank, attempts, responses, and the persisted competency
-- baseline the pathway engine (W03) will read.

do $$ begin
  create type public.btg_diagnostic_status as enum ('draft','published','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_attempt_status as enum ('in_progress','submitted','scored','abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_question_kind as enum ('single_choice','multi_choice','self_report');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_competency_source as enum ('baseline','assessment','evidence','review');
exception when duplicate_object then null; end $$;

create table if not exists public.diagnostics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])$'),
  title text not null check (char_length(btrim(title)) between 4 and 160),
  description text check (description is null or char_length(description) <= 800),
  status public.btg_diagnostic_status not null default 'draft',
  version smallint not null default 1 check (version >= 1),
  -- Exactly one published baseline is served at onboarding.
  is_baseline boolean not null default false,
  -- Questions asked per competency before the adaptive walk moves on.
  max_questions smallint not null default 12 check (max_questions between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.diagnostics is 'E3: a diagnostic instrument. Baseline is the one served at onboarding.';

create unique index if not exists diagnostics_single_published_baseline
  on public.diagnostics ((true)) where is_baseline and status = 'published';

create table if not exists public.diagnostic_questions (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  -- The level this question probes; the adaptive walk uses it to step up/down.
  level smallint not null check (level between 1 and 5),
  kind public.btg_question_kind not null default 'single_choice',
  prompt text not null check (char_length(btrim(prompt)) between 8 and 1000),
  /* [{ "id": "a", "label": "…" }, …] — options never carry correctness. */
  options jsonb not null,
  explanation text check (explanation is null or char_length(explanation) <= 800),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint diagnostic_questions_options_shape check (
    jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8
  )
);
comment on table public.diagnostic_questions is
  'E3: question bank. Correctness lives in diagnostic_answer_keys, never here.';

create index if not exists diagnostic_questions_walk_idx
  on public.diagnostic_questions (diagnostic_id, competency_id, level, sort_order);

-- Answer keys are a separate relation with NO grant to `authenticated`, so a
-- learner cannot read the correct answers even with a valid session. Only the
-- security-definer scoring command touches them.
create table if not exists public.diagnostic_answer_keys (
  question_id uuid primary key references public.diagnostic_questions(id) on delete cascade,
  correct_option_ids text[] not null check (array_length(correct_option_ids, 1) >= 1),
  /* Weight of this question when scoring its competency. */
  weight numeric(4,2) not null default 1.00 check (weight > 0 and weight <= 10)
);
comment on table public.diagnostic_answer_keys is
  'E3: correctness, isolated from the question bank. Never readable by a learner.';

create table if not exists public.diagnostic_attempts (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status public.btg_attempt_status not null default 'in_progress',
  /* Denormalised for cheap resume + progress display. */
  answered_count smallint not null default 0 check (answered_count >= 0),
  question_budget smallint not null check (question_budget between 1 and 60),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  scored_at timestamptz,
  abandoned_at timestamptz,
  /* Per-competency scoring summary written by the scoring command. */
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attempts_submitted_consistency check (
    (status in ('submitted','scored')) = (submitted_at is not null)
  ),
  constraint attempts_scored_consistency check ((status = 'scored') = (scored_at is not null)),
  constraint attempts_scored_has_result check (status <> 'scored' or result is not null),
  constraint attempts_abandoned_consistency check ((status = 'abandoned') = (abandoned_at is not null))
);
comment on table public.diagnostic_attempts is 'E3: one learner sitting one diagnostic.';

-- A learner may hold only one live attempt per diagnostic.
create unique index if not exists diagnostic_attempts_one_live
  on public.diagnostic_attempts (profile_id, diagnostic_id) where status = 'in_progress';
create index if not exists diagnostic_attempts_profile_idx
  on public.diagnostic_attempts (profile_id, started_at desc);

create table if not exists public.diagnostic_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.diagnostic_attempts(id) on delete cascade,
  question_id uuid not null references public.diagnostic_questions(id) on delete restrict,
  selected_option_ids text[] not null check (array_length(selected_option_ids, 1) >= 1),
  /* Graded by the scoring command, never supplied by the client. */
  is_correct boolean,
  responded_at timestamptz not null default now(),
  elapsed_ms integer check (elapsed_ms is null or elapsed_ms between 0 and 3600000),
  unique (attempt_id, question_id)
);
comment on table public.diagnostic_responses is 'E3: one answer. is_correct is server-graded.';

create index if not exists diagnostic_responses_attempt_idx
  on public.diagnostic_responses (attempt_id, responded_at);

-- The persisted baseline: the authoritative record of where a learner stands.
create table if not exists public.learner_competencies (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete cascade,
  level smallint not null check (level between 0 and 5),
  /* 0..1 — how much evidence stands behind the level. */
  confidence numeric(3,2) not null default 0.50 check (confidence >= 0 and confidence <= 1),
  source public.btg_competency_source not null default 'baseline',
  attempt_id uuid references public.diagnostic_attempts(id) on delete set null,
  measured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, competency_id)
);
comment on table public.learner_competencies is
  'E3/E4: measured competency level per learner. Level 0 means measured but not yet demonstrated.';

create index if not exists learner_competencies_competency_idx
  on public.learner_competencies (competency_id, level);

-- Routing reads this one flag rather than aggregating attempts on every request.
alter table public.profiles
  add column if not exists baseline_completed_at timestamptz;

do $$
declare t text;
begin
  foreach t in array array['diagnostics','diagnostic_attempts','learner_competencies'] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format('create trigger %I_touch_updated_at before update on public.%I
                      for each row execute function btg.touch_updated_at()', t, t);
  end loop;
end $$;

-- Attempt lifecycle, registered in the one transition registry.
insert into btg.state_transitions (machine, from_state, to_state) values
  ('diagnostic_attempt','in_progress','submitted'),
  ('diagnostic_attempt','in_progress','abandoned'),
  ('diagnostic_attempt','submitted','scored'),
  ('diagnostic_attempt','submitted','abandoned')
on conflict do nothing;

drop trigger if exists diagnostic_attempts_enforce_transition on public.diagnostic_attempts;
create trigger diagnostic_attempts_enforce_transition
  before update of status on public.diagnostic_attempts
  for each row execute function btg.enforce_transition('diagnostic_attempt', 'status');

insert into btg.state_transitions (machine, from_state, to_state) values
  ('diagnostic','draft','published'),
  ('diagnostic','draft','archived'),
  ('diagnostic','published','archived')
on conflict do nothing;

drop trigger if exists diagnostics_enforce_transition on public.diagnostics;
create trigger diagnostics_enforce_transition
  before update of status on public.diagnostics
  for each row execute function btg.enforce_transition('diagnostic', 'status');

-- ------------------------------------------------------------------- RLS ---
alter table public.diagnostics enable row level security;
alter table public.diagnostic_questions enable row level security;
alter table public.diagnostic_answer_keys enable row level security;
alter table public.diagnostic_attempts enable row level security;
alter table public.diagnostic_responses enable row level security;
alter table public.learner_competencies enable row level security;

drop policy if exists diagnostics_select on public.diagnostics;
create policy diagnostics_select on public.diagnostics for select to authenticated
using (status = 'published' or btg.is_operator());

drop policy if exists diagnostics_write on public.diagnostics;
create policy diagnostics_write on public.diagnostics for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

-- A learner may read the questions of a published diagnostic. Correctness is
-- not in this table, so this exposes nothing gradeable.
drop policy if exists diagnostic_questions_select on public.diagnostic_questions;
create policy diagnostic_questions_select on public.diagnostic_questions for select to authenticated
using (
  btg.is_operator()
  or exists (
    select 1 from public.diagnostics d
    where d.id = diagnostic_questions.diagnostic_id and d.status = 'published'
  )
);

drop policy if exists diagnostic_questions_write on public.diagnostic_questions;
create policy diagnostic_questions_write on public.diagnostic_questions for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

-- Answer keys: operators only, and no table grant for learners at all.
drop policy if exists diagnostic_answer_keys_operator on public.diagnostic_answer_keys;
create policy diagnostic_answer_keys_operator on public.diagnostic_answer_keys for all to authenticated
using (btg.is_operator()) with check (btg.is_operator());

drop policy if exists diagnostic_attempts_select on public.diagnostic_attempts;
create policy diagnostic_attempts_select on public.diagnostic_attempts for select to authenticated
using (
  profile_id = auth.uid()
  or btg.is_operator()
  or exists (
    select 1 from public.memberships m
    where m.profile_id = diagnostic_attempts.profile_id and m.status = 'active'
      and m.organization_id in (select btg.governed_org_ids())
  )
);

drop policy if exists diagnostic_responses_select on public.diagnostic_responses;
create policy diagnostic_responses_select on public.diagnostic_responses for select to authenticated
using (
  exists (
    select 1 from public.diagnostic_attempts a
    where a.id = diagnostic_responses.attempt_id
      and (a.profile_id = auth.uid() or btg.is_operator())
  )
);

drop policy if exists learner_competencies_select on public.learner_competencies;
create policy learner_competencies_select on public.learner_competencies for select to authenticated
using (
  profile_id = auth.uid()
  or btg.is_operator()
  or exists (
    select 1 from public.memberships m
    where m.profile_id = learner_competencies.profile_id and m.status = 'active'
      and m.organization_id in (select btg.governed_org_ids())
  )
);

-- Attempts, responses and baselines are written only by the domain commands
-- below, so `authenticated` gets no direct INSERT/UPDATE on any of them.
grant select on public.diagnostics to authenticated;
grant insert, update, delete on public.diagnostics to authenticated;
grant select on public.diagnostic_questions to authenticated;
grant insert, update, delete on public.diagnostic_questions to authenticated;
grant select on public.diagnostic_attempts to authenticated;
grant select on public.diagnostic_responses to authenticated;
grant select on public.learner_competencies to authenticated;
