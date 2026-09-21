-- E7 AI Tutor, governed.
-- The tutor may explain, question, hint, critique and recommend. It may not
-- submit graded work, fabricate assessment, verify a skill, issue a credential
-- or change authoritative learner state. Those are enforced structurally: the
-- tutor has no write path to any of them, and the one table it does write is
-- a transcript.

do $$ begin
  create type public.btg_tutor_intent as enum
    ('explain','question','hint','critique','recommend_next');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.btg_tutor_outcome as enum
    ('delivered','refused_policy','refused_scope','provider_unavailable','invalid_output');
exception when duplicate_object then null; end $$;

create table if not exists public.tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  /* The learner context the tutor was allowed to see. */
  pathway_step_id uuid references public.pathway_steps(id) on delete set null,
  module_id uuid references public.learning_modules(id) on delete set null,
  competency_id uuid references public.competencies(id) on delete set null,
  started_at timestamptz not null default now(),
  last_turn_at timestamptz not null default now(),
  turn_count smallint not null default 0 check (turn_count >= 0),
  created_at timestamptz not null default now()
);
comment on table public.tutor_sessions is 'E7: one tutoring conversation, bound to a pathway context.';

create index if not exists tutor_sessions_profile_idx
  on public.tutor_sessions (profile_id, last_turn_at desc);

create table if not exists public.tutor_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tutor_sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  ordinal smallint not null check (ordinal >= 1),
  intent public.btg_tutor_intent not null,
  learner_message text not null check (char_length(btrim(learner_message)) between 1 and 4000),
  /* Null when nothing was delivered — a refusal is still a recorded turn. */
  tutor_response text check (tutor_response is null or char_length(tutor_response) <= 8000),
  outcome public.btg_tutor_outcome not null,
  /* Governance metadata: which policy and instruction version applied. */
  policy_version text not null,
  instruction_version text not null,
  model text,
  /* Set when the turn was refused, so the reason is inspectable. */
  refusal_reason text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, ordinal),
  constraint tutor_turns_refusal_reason check (
    outcome = 'delivered' or refusal_reason is not null
  ),
  constraint tutor_turns_delivered_has_response check (
    outcome <> 'delivered' or tutor_response is not null
  )
);
comment on table public.tutor_turns is
  'E7: append-only transcript. A refusal is recorded as fully as an answer.';

create index if not exists tutor_turns_session_idx on public.tutor_turns (session_id, ordinal);
create index if not exists tutor_turns_outcome_idx on public.tutor_turns (outcome, created_at desc);

-- The transcript is evidence of what the tutor did; it does not get rewritten.
drop trigger if exists tutor_turns_append_only on public.tutor_turns;
create trigger tutor_turns_append_only
  before update or delete on public.tutor_turns
  for each row execute function btg.reject_mutation();

alter table public.tutor_sessions enable row level security;
alter table public.tutor_turns enable row level security;

drop policy if exists tutor_sessions_select on public.tutor_sessions;
create policy tutor_sessions_select on public.tutor_sessions for select to authenticated
using (profile_id = auth.uid() or btg.is_operator());

drop policy if exists tutor_turns_select on public.tutor_turns;
create policy tutor_turns_select on public.tutor_turns for select to authenticated
using (profile_id = auth.uid() or btg.is_operator());

grant select on public.tutor_sessions, public.tutor_turns to authenticated;
grant all on public.tutor_sessions, public.tutor_turns to service_role;
