-- W14-D — private orchestration stream and the generic dispatcher.
--
-- Three things arrive here, and one thing deliberately does not.
--
--   btg.orchestration_events   the trusted, append-only execution stream.
--                              Not the audit ledger: the ledger is evidence of
--                              what happened to the domain, this is a record of
--                              what the runtime did. Neither drives the other.
--   btg.workflow_commands      the allowlist of domain commands a step may name.
--   btg.dispatch_workflow_work one generic dispatcher over the W14-B queue.
--
-- What does not arrive: a second queue. The dispatcher claims from
-- btg.work_queue, which already has leases, backoff, dead-lettering and reaping
-- proved by 16 tests.
--
-- The rule that shapes the domain bridge: **the runtime is a worker, never an
-- actor.** It does not impersonate a learner, a reviewer or an operator to
-- drive a governed command. So the allowlist admits only commands that carry
-- their own system authority, and refuses -- structurally, with a trigger --
-- any command that writes the audit ledger through the session-facing writer,
-- because such a command needs an actor the runtime does not have and must not
-- invent. Work a person authors stays a human work item that waits for that
-- person to act in their own session.

-- ------------------------------------------------------------------ enums ---
do $$ begin
  create type public.btg_orchestration_event as enum (
    'scheduled', 'claimed', 'handler_resolved', 'domain_command_invoked',
    'awaiting_domain_state', 'awaiting_human', 'completed', 'failed',
    'retry_scheduled', 'dead_lettered', 'lease_expired', 'skipped', 'signalled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------- handler resolvability ---
/* Which handler classes a dispatcher can actually carry out. A definition
   naming an unresolvable handler is refused at start time rather than
   stranding an instance mid-run, and enabling a class later is one row -- not
   a change to btg.start_workflow. */
create table if not exists btg.workflow_handlers (
  handler public.btg_workflow_handler primary key,
  is_resolvable boolean not null default false,
  description text not null
);

insert into btg.workflow_handlers (handler, is_resolvable, description) values
  ('noop', true, 'Completes immediately. A marker step.'),
  ('await_domain_state', true,
   'Waits until the engines show the step''s completion check. Woken by a signal; paced re-checks are the safety net.'),
  ('domain_command', true,
   'Invokes one allowlisted system-authority command, then re-verifies the domain.'),
  ('timer', true, 'Completes once available_at has passed.'),
  ('human_review', false, 'A person''s work. Assignment and completion are W14-E.'),
  ('approval', false, 'A person''s decision. W14-E.'),
  ('ai_worker', false, 'An AI work item. No AI worker is wired; refused rather than stranded.'),
  ('external_call', false, 'An outbound call. No egress worker exists.')
on conflict (handler) do update set
  is_resolvable = excluded.is_resolvable, description = excluded.description;

-- --------------------------------------------------------- command allowlist ---
create table if not exists btg.workflow_commands (
  name text primary key check (name ~ '^[a-z0-9_]{3,60}$'),
  requires_subject boolean not null default true,
  /* True when the command writes the ledger through public.record_audit_event,
     which raises 28000 without auth.uid(). Such a command is NOT worker-
     drivable, and saying so as data means a step cannot name it by mistake. */
  requires_session_actor boolean not null default false,
  description text not null
);

insert into btg.workflow_commands (name, requires_subject, requires_session_actor, description) values
  ('compute_opportunity_matches', true, false,
   'Recomputes this learner''s matches. Arithmetic over verified skills; idempotent by upsert; writes no ledger row.'),
  ('drain_notifications', false, false,
   'W14-B notification dispatch. No subject, no ledger write.'),
  ('issue_eligible_credentials', true, true,
   'NOT worker-drivable: records credential.credential.issued through the session-facing ledger writer, which requires an actor. Issuance rides the transaction of the reviewer decision that earned it.'),
  ('complete_pathway_step', true, true,
   'NOT worker-drivable: writes the ledger as a session actor. Driven from inside the learner''s own governed command.')
on conflict (name) do update set
  requires_subject = excluded.requires_subject,
  requires_session_actor = excluded.requires_session_actor,
  description = excluded.description;

alter table public.workflow_definition_steps
  drop constraint if exists workflow_step_command_allowlisted;
alter table public.workflow_definition_steps
  add constraint workflow_step_command_allowlisted
  foreign key (domain_command) references btg.workflow_commands(name);

alter table public.workflow_definition_steps
  drop constraint if exists workflow_step_command_present;
alter table public.workflow_definition_steps
  add constraint workflow_step_command_present
  check ((handler = 'domain_command') = (domain_command is not null));

/* A step may not name a command the runtime would have to impersonate someone
   to call. Cross-table, so a trigger rather than a check. */
create or replace function btg.guard_step_command()
returns trigger language plpgsql set search_path = public, btg, pg_temp as $$
declare v_needs_actor boolean;
begin
  if new.domain_command is null then return new; end if;
  select requires_session_actor into v_needs_actor
  from btg.workflow_commands where name = new.domain_command;
  if v_needs_actor then
    raise exception
      'command % needs a session actor; the runtime is a worker, not an actor',
      new.domain_command using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_steps_command_guard on public.workflow_definition_steps;
create trigger workflow_steps_command_guard
  before insert or update on public.workflow_definition_steps
  for each row execute function btg.guard_step_command();

-- --------------------------------------------------- orchestration stream ---
create table if not exists btg.orchestration_events (
  event_id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null
    references public.workflow_instances(id) on delete cascade,
  work_item_id uuid references public.workflow_work_items(id) on delete cascade,
  step_key text,
  event_type public.btg_orchestration_event not null,
  idempotency_key text,
  source text not null check (source ~ '^[a-z0-9_.:-]{2,64}$'),
  payload jsonb not null default '{}'::jsonb
    check (octet_length(payload::text) <= 4096),
  attempt integer not null default 0 check (attempt >= 0),
  /* clock_timestamp, not now(): several events are emitted inside one
     transaction and must stay orderable. */
  occurred_at timestamptz not null default clock_timestamp()
);
comment on table btg.orchestration_events is
  'W14-D: append-only execution stream. service_role only -- no session role may publish an executable event.';

create unique index if not exists orchestration_events_idempotent
  on btg.orchestration_events (idempotency_key) where idempotency_key is not null;
create index if not exists orchestration_events_instance_idx
  on btg.orchestration_events (workflow_instance_id, occurred_at);
create index if not exists orchestration_events_item_idx
  on btg.orchestration_events (work_item_id, event_type);

-- The stream is a record of what the runtime did; it does not get rewritten.
drop trigger if exists orchestration_events_append_only on btg.orchestration_events;
create trigger orchestration_events_append_only
  before update or delete on btg.orchestration_events
  for each row execute function btg.reject_mutation();

/* Dedupe for the queue: one live row per work item. An expression index so the
   lookup is not a scan. */
create index if not exists work_queue_workflow_item_idx
  on btg.work_queue (((payload->>'work_item_id')))
  where queue = 'workflow';

grant select, insert on btg.orchestration_events to service_role;
grant select, insert, update, delete on btg.workflow_commands, btg.workflow_handlers
  to service_role;

-- ------------------------------------------------------------- emit + enqueue ---
create or replace function btg.emit_orchestration_event(
  p_instance_id uuid,
  p_event_type public.btg_orchestration_event,
  p_item_id uuid default null,
  p_step_key text default null,
  p_payload jsonb default '{}'::jsonb,
  p_attempt integer default 0,
  p_source text default 'dispatcher',
  p_idempotency_key text default null
)
returns uuid language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_id uuid;
begin
  insert into btg.orchestration_events (
    workflow_instance_id, work_item_id, step_key, event_type, payload, attempt,
    source, idempotency_key
  ) values (
    p_instance_id, p_item_id, p_step_key, p_event_type, coalesce(p_payload, '{}'::jsonb),
    p_attempt, p_source, p_idempotency_key
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning event_id into v_id;
  return v_id;
end;
$$;

/* Execution intent and queue insertion in one statement pair inside one
   function, so there is no commit-then-enqueue window in which work is lost.
   A live queue row for the item means nothing is added -- that is the dedupe
   for a duplicate delivery. */
create or replace function btg.enqueue_workflow_step(
  p_item_id uuid,
  p_delay interval default interval '0',
  p_reason text default 'scheduled'
)
returns bigint language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare
  v_item public.workflow_work_items;
  v_queue_id bigint;
begin
  select * into v_item from public.workflow_work_items where id = p_item_id;
  if not found then
    raise exception 'work item not found' using errcode = 'P0002';
  end if;
  if v_item.status not in ('pending','ready','claimed') then
    return null;
  end if;

  if exists (
    select 1 from btg.work_queue q
    where q.queue = 'workflow'
      and q.status in ('queued','claimed')
      and (q.payload->>'work_item_id') = p_item_id::text
  ) then
    return null;
  end if;

  v_queue_id := btg.enqueue_work(
    'workflow',
    jsonb_build_object('work_item_id', p_item_id,
                       'instance_id', v_item.workflow_instance_id,
                       'step_key', v_item.step_key),
    null,
    now() + coalesce(p_delay, interval '0'),
    5);

  perform btg.emit_orchestration_event(
    v_item.workflow_instance_id, 'scheduled', p_item_id, v_item.step_key,
    jsonb_build_object('reason', p_reason, 'delay_seconds',
                       extract(epoch from coalesce(p_delay, interval '0'))::int,
                       'queue_id', v_queue_id),
    v_item.attempts);

  return v_queue_id;
end;
$$;

/* Whatever became ready on this instance gets a queue row. Called after every
   advance, so the run keeps moving without anything polling for it. */
create or replace function btg.enqueue_ready_steps(p_instance_id uuid)
returns integer language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_item record; v_count integer := 0;
begin
  for v_item in
    select w.id, s.handler, w.subject_type, c.requires_subject_type
    from public.workflow_work_items w
    join public.workflow_instances i on i.id = w.workflow_instance_id
    join public.workflow_definition_steps s
      on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
    left join btg.workflow_checks c on c.name = s.completion_check
    where w.workflow_instance_id = p_instance_id and w.status = 'ready'
  loop
    -- A person's work is not queued: nothing polls a human.
    if v_item.handler in ('human_review','approval') then continue; end if;

    /* An await step that needs an entity it has not been given yet is not
       work: dispatching it would raise and burn a retry. It waits for the
       signal that names the entity. */
    if v_item.handler = 'await_domain_state'
       and v_item.subject_type is null
       and v_item.requires_subject_type is not null then
      continue;
    end if;

    if btg.enqueue_workflow_step(v_item.id, interval '0', 'ready') is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- --------------------------------------------------------------- the bridge ---
/* The only path from the runtime into the domain. A CASE over allowlisted
   names -- no dynamic SQL, so a payload can never name what gets executed. */
create or replace function btg.invoke_domain_command(
  p_command text,
  p_profile uuid,
  p_subject_id uuid default null
)
returns jsonb language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_cmd btg.workflow_commands; v_out jsonb;
begin
  select * into v_cmd from btg.workflow_commands where name = p_command;
  if not found then
    raise exception 'command % is not allowlisted', p_command using errcode = '42501';
  end if;
  if v_cmd.requires_session_actor then
    raise exception
      'command % needs a session actor; the runtime is a worker, not an actor',
      p_command using errcode = '42501';
  end if;
  if v_cmd.requires_subject and p_profile is null then
    raise exception 'command % needs a subject profile', p_command
      using errcode = 'check_violation';
  end if;

  case p_command
    when 'compute_opportunity_matches' then
      v_out := jsonb_build_object('matches', btg.compute_opportunity_matches(p_profile));
    when 'drain_notifications' then
      select to_jsonb(d) into v_out
      from btg.drain_notifications('workflow-dispatcher', 25, 60) d;
    else
      raise exception 'command % is allowlisted but not implemented', p_command
        using errcode = '42501';
  end case;

  return coalesce(v_out, '{}'::jsonb);
end;
$$;

/* Terminal failure of one step, and of the run with it. Distinct from
   btg.fail_work_item, which schedules another attempt: a deadline that has
   passed and a dead-lettered poison item are not retryable, and asking for
   another attempt would spin forever. */
create or replace function btg.abandon_work_item(p_item_id uuid, p_reason text)
returns public.workflow_work_items
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_item public.workflow_work_items;
begin
  select * into v_item from public.workflow_work_items where id = p_item_id for update;
  if not found then raise exception 'work item not found' using errcode = 'P0002'; end if;
  if v_item.status in ('failed','cancelled','completed') then return v_item; end if;

  update public.workflow_work_items
  set status = 'failed', attempts = greatest(attempts, 1), failure = p_reason,
      claimed_by = null, lease_until = null
  where id = p_item_id
  returning * into v_item;

  update public.workflow_instances
  set status = 'failed', settled_at = now(),
      failure = 'step ' || v_item.step_key || ': ' || p_reason
  where id = v_item.workflow_instance_id and status in ('created','active','waiting');

  perform btg.record_workflow_event(
    'workflow.instance.failed', 'workflow_instance', v_item.workflow_instance_id::text,
    (select organization_id from public.workflow_instances
     where id = v_item.workflow_instance_id),
    null,
    jsonb_build_object('step', v_item.step_key, 'reason', p_reason,
                       'attempts', v_item.attempts),
    'critical'::public.btg_audit_severity, null);

  return v_item;
end;
$$;

-- ------------------------------------------------------------- the signal ---
/* The event-driven wake, and the only place a waiting step learns which domain
   entity it is waiting on. Anything that knows a domain entity changed calls
   this; every waiting step of that learner's runs is bound if it needs binding
   and scheduled immediately. This is how a wait ends. The dispatcher's paced
   re-check is only the safety net for a change nobody signalled.

   p_profile is mandatory: scoping every signal to one learner makes cross-user
   isolation structural rather than a property of uuid collision odds. */
drop function if exists btg.signal_workflow_subject(text, uuid, uuid);

create or replace function btg.signal_workflow_subject(
  p_profile uuid,
  p_subject_type text default null,
  p_subject_id uuid default null
)
returns integer language plpgsql security definer
set search_path = public, btg, pg_temp as $$
declare v_item record; v_count integer := 0;
begin
  if p_profile is null then
    raise exception 'a signal is scoped to one subject profile' using errcode = 'check_violation';
  end if;

  for v_item in
    select w.id, w.workflow_instance_id, w.step_key,
           w.subject_type as bound_type, c.requires_subject_type
    from public.workflow_work_items w
    join public.workflow_instances i on i.id = w.workflow_instance_id
    join public.workflow_definition_steps s
      on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
    left join btg.workflow_checks c on c.name = s.completion_check
    where w.status = 'ready'
      and s.handler = 'await_domain_state'
      and i.status in ('active','waiting')
      and i.subject_profile_id = p_profile
      and (
        -- already bound to exactly this entity
        (w.subject_type = p_subject_type and w.subject_id = p_subject_id)
        -- unbound, and its check asks for exactly this kind of entity
        or (w.subject_type is null and p_subject_type is not null
            and c.requires_subject_type = p_subject_type)
        -- unbound, and its check needs no entity at all
        or (w.subject_type is null and c.requires_subject_type is null)
      )
  loop
    /* Bind only when the check asks for this kind of entity, and never rebind:
       a signal can neither point a step at the wrong entity nor move one. */
    if v_item.bound_type is null
       and p_subject_id is not null
       and v_item.requires_subject_type = p_subject_type then
      perform btg.bind_work_item_subject(v_item.id, p_subject_type, p_subject_id);
    end if;

    perform btg.emit_orchestration_event(
      v_item.workflow_instance_id, 'signalled', v_item.id, v_item.step_key,
      jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id),
      0, 'signal');

    -- Clear any paced re-check so the signal is acted on now, not later.
    update btg.work_queue
    set available_at = now()
    where queue = 'workflow' and status = 'queued'
      and (payload->>'work_item_id') = v_item.id::text;

    if not exists (
      select 1 from btg.work_queue q
      where q.queue = 'workflow' and q.status in ('queued','claimed')
        and (q.payload->>'work_item_id') = v_item.id::text
    ) then
      perform btg.enqueue_workflow_step(v_item.id, interval '0', 'signal');
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ------------------------------------------------------------ the dispatcher ---
/* One dispatcher for every handler class. Per claimed queue row:
     load -> validate lifecycle -> resolve allowlisted handler -> execute
          -> record -> advance -> enqueue continuation
   A handler that raises rolls back its own subtransaction, so a failed attempt
   leaves no half-applied domain effect, and the queue row carries the retry. */
create or replace function btg.dispatch_workflow_work(
  p_worker text default 'workflow-dispatcher',
  p_batch integer default 10,
  p_lease_seconds integer default 60
)
returns table (
  claimed integer, completed integer, waiting integer,
  retried integer, failed integer, dead integer, skipped integer
)
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_row btg.work_queue;
  v_item public.workflow_work_items;
  v_instance public.workflow_instances;
  v_step public.workflow_definition_steps;
  v_resolvable boolean;
  v_item_id uuid;
  v_done boolean;
  v_result jsonb;
  v_waits integer;
  v_delay interval;
  v_status btg.work_status;
  v_outcome text;
begin
  claimed := 0; completed := 0; waiting := 0;
  retried := 0; failed := 0; dead := 0; skipped := 0;

  for v_row in select * from btg.claim_work('workflow', p_worker, p_lease_seconds, p_batch)
  loop
    claimed := claimed + 1;
    v_item_id := (v_row.payload->>'work_item_id')::uuid;

    select * into v_item from public.workflow_work_items where id = v_item_id for update;
    if not found then
      perform btg.fail_work_permanently(v_row.id, 'work item no longer exists');
      dead := dead + 1;
      continue;
    end if;

    select * into v_instance from public.workflow_instances
    where id = v_item.workflow_instance_id;

    perform btg.emit_orchestration_event(
      v_instance.id, 'claimed', v_item_id, v_item.step_key,
      jsonb_build_object('worker', p_worker, 'queue_id', v_row.id),
      v_row.attempts, 'dispatcher');

    -- Lifecycle: a settled instance or a settled item is not work.
    if v_instance.status not in ('active','waiting')
       or v_item.status not in ('ready','claimed') then
      perform btg.emit_orchestration_event(
        v_instance.id, 'skipped', v_item_id, v_item.step_key,
        jsonb_build_object('instance_status', v_instance.status,
                           'item_status', v_item.status), v_row.attempts);
      perform btg.complete_work(v_row.id);
      skipped := skipped + 1;
      continue;
    end if;

    select * into v_step from public.workflow_definition_steps
    where definition_version_id = v_instance.definition_version_id
      and step_key = v_item.step_key;

    select is_resolvable into v_resolvable
    from btg.workflow_handlers where handler = v_step.handler;

    if not coalesce(v_resolvable, false) then
      perform btg.emit_orchestration_event(
        v_instance.id, 'failed', v_item_id, v_item.step_key,
        jsonb_build_object('reason', 'handler not resolvable',
                           'handler', v_step.handler), v_row.attempts);
      perform btg.abandon_work_item(v_item_id, format('handler %s is not resolvable', v_step.handler));
      perform btg.fail_work_permanently(v_row.id, 'handler not resolvable');
      failed := failed + 1;
      continue;
    end if;

    perform btg.emit_orchestration_event(
      v_instance.id, 'handler_resolved', v_item_id, v_item.step_key,
      jsonb_build_object('handler', v_step.handler,
                         'command', v_step.domain_command,
                         'check', v_step.completion_check), v_row.attempts);

    v_done := false;
    v_result := '{}'::jsonb;
    v_outcome := null;

    /* Execution and completion share one subtransaction. A handler that
       raises -- or a completion the domain then refuses -- rolls back every
       effect of the attempt, so a retry never sees half of a previous one.
       This is also why the queue insertion for the next step sits inside the
       block: intent and enqueue commit together or not at all. */
    begin
      case v_step.handler
        when 'noop' then
          v_done := true;

        when 'timer' then
          v_done := v_item.available_at <= now();

        when 'await_domain_state' then
          v_done := btg.assert_step_satisfied(
            v_step.completion_check, v_item.subject_type, v_item.subject_id,
            v_instance.subject_profile_id);

        when 'domain_command' then
          v_result := btg.invoke_domain_command(
            v_step.domain_command, v_instance.subject_profile_id, v_item.subject_id);
          perform btg.emit_orchestration_event(
            v_instance.id, 'domain_command_invoked', v_item_id, v_item.step_key,
            jsonb_build_object('command', v_step.domain_command, 'result', v_result),
            v_row.attempts);
          v_done := true;

        when 'human_review' then
          v_done := false;
        when 'approval' then
          v_done := false;
        else
          raise exception 'handler % has no dispatcher branch', v_step.handler
            using errcode = '42501';
      end case;

      if v_step.handler in ('human_review','approval') then
        -- A person's work waits for the person. Nothing polls a human.
        perform btg.emit_orchestration_event(
          v_instance.id, 'awaiting_human', v_item_id, v_item.step_key,
          jsonb_build_object('owner_kind', v_item.owner_kind,
                             'owner_persona', v_item.owner_persona,
                             'deadline_at', v_item.deadline_at), v_row.attempts);
        perform btg.complete_work(v_row.id);
        v_outcome := 'waiting';

      elsif v_done then
        perform btg.complete_work_item(v_item_id, v_result);
        perform btg.emit_orchestration_event(
          v_instance.id, 'completed', v_item_id, v_item.step_key,
          jsonb_build_object('result', v_result), v_row.attempts);
        perform btg.complete_work(v_row.id);
        perform btg.enqueue_ready_steps(v_instance.id);
        v_outcome := 'completed';

      elsif v_item.deadline_at is not null and v_item.deadline_at < now() then
        perform btg.emit_orchestration_event(
          v_instance.id, 'failed', v_item_id, v_item.step_key,
          jsonb_build_object('reason', 'deadline passed',
                             'check', v_step.completion_check), v_row.attempts);
        perform btg.abandon_work_item(
          v_item_id, format('deadline passed waiting for %s', v_step.completion_check));
        perform btg.fail_work_permanently(v_row.id, 'deadline passed');
        v_outcome := 'failed';

      else
        -- Still waiting on the domain. Re-check on a widening interval; the
        -- signal is what normally ends the wait before any of these fire.
        select count(*) into v_waits from btg.orchestration_events
        where work_item_id = v_item_id and event_type = 'awaiting_domain_state';
        v_delay := least(
          interval '1 hour',
          (power(2, least(v_waits, 7)) * interval '30 seconds'));

        perform btg.emit_orchestration_event(
          v_instance.id, 'awaiting_domain_state', v_item_id, v_item.step_key,
          jsonb_build_object('check', v_step.completion_check,
                             'recheck_in_seconds', extract(epoch from v_delay)::int),
          v_row.attempts);
        perform btg.complete_work(v_row.id);
        perform btg.enqueue_workflow_step(v_item_id, v_delay, 'await recheck');
        v_outcome := 'waiting';
      end if;

    exception when others then
      v_status := btg.fail_work(v_row.id, sqlerrm);
      if v_status = 'dead' then
        perform btg.emit_orchestration_event(
          v_instance.id, 'dead_lettered', v_item_id, v_item.step_key,
          jsonb_build_object('error', sqlerrm), v_row.attempts);
        perform btg.abandon_work_item(v_item_id, sqlerrm);
        v_outcome := 'dead';
      else
        perform btg.emit_orchestration_event(
          v_instance.id, 'retry_scheduled', v_item_id, v_item.step_key,
          jsonb_build_object('error', sqlerrm), v_row.attempts);
        v_outcome := 'retried';
      end if;
    end;

    case v_outcome
      when 'completed' then completed := completed + 1;
      when 'waiting' then waiting := waiting + 1;
      when 'retried' then retried := retried + 1;
      when 'failed' then failed := failed + 1;
      when 'dead' then dead := dead + 1;
      else null;
    end case;
  end loop;

  return next;
end;
$$;

-- ------------------------------------------- start_workflow, now dispatched ---
/* Two changes: the handler gate reads btg.workflow_handlers instead of naming
   one handler inline, and the first ready step is queued so a run actually
   moves. Nothing else about the function changes. */
create or replace function btg.start_workflow(
  p_definition_key text,
  p_subject_profile_id uuid,
  p_organization_id uuid default null,
  p_idempotency_key text default null
)
returns public.workflow_instances
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_def public.workflow_definitions;
  v_version public.workflow_definition_versions;
  v_instance public.workflow_instances;
  v_step record;
  v_existing uuid;
  v_unresolvable text;
begin
  select * into v_def from public.workflow_definitions where key = p_definition_key;
  if not found then
    raise exception 'workflow % is not defined', p_definition_key using errcode = 'P0002';
  end if;
  if not v_def.is_enabled then
    raise exception 'workflow % is not enabled', p_definition_key using errcode = 'check_violation';
  end if;
  if v_def.scope = 'organization' and p_organization_id is null then
    raise exception 'workflow % is organization-scoped', p_definition_key
      using errcode = 'check_violation';
  end if;

  select * into v_version from public.workflow_definition_versions
  where definition_id = v_def.id and status = 'published';
  if not found then
    raise exception 'workflow % has no published version', p_definition_key
      using errcode = 'check_violation';
  end if;

  -- A handler no dispatcher resolves would strand the instance.
  select string_agg(distinct s.handler::text, ', ') into v_unresolvable
  from public.workflow_definition_steps s
  left join btg.workflow_handlers h on h.handler = s.handler
  where s.definition_version_id = v_version.id
    and not coalesce(h.is_resolvable, false);
  if v_unresolvable is not null then
    raise exception 'version % uses unresolvable handlers: %', v_version.version, v_unresolvable
      using errcode = 'feature_not_supported';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.workflow_instances
    where idempotency_key = p_idempotency_key;
    if found then
      select * into v_instance from public.workflow_instances where id = v_existing;
      return v_instance;
    end if;
  end if;

  insert into public.workflow_instances (
    definition_version_id, organization_id, subject_profile_id, idempotency_key
  ) values (
    v_version.id, p_organization_id, p_subject_profile_id, p_idempotency_key
  )
  returning * into v_instance;

  for v_step in
    select * from public.workflow_definition_steps
    where definition_version_id = v_version.id order by ordinal
  loop
    insert into public.workflow_work_items (
      workflow_instance_id, step_key, item_type, owner_kind, owner_persona,
      priority, max_attempts, deadline_at, idempotency_key
    ) values (
      v_instance.id, v_step.step_key, v_step.item_type, v_step.owner_kind,
      v_step.owner_persona, v_step.priority, v_step.max_attempts,
      case when v_step.sla_hours is null then null
           else now() + make_interval(hours => floor(v_step.sla_hours)::int,
                                      mins => round((v_step.sla_hours - floor(v_step.sla_hours)) * 60)::int)
      end,
      v_instance.id::text || ':' || v_step.step_key
    );
  end loop;

  update public.workflow_instances
  set status = 'active', started_at = now()
  where id = v_instance.id
  returning * into v_instance;

  perform btg.record_workflow_event(
    'workflow.instance.started', 'workflow_instance', v_instance.id::text,
    p_organization_id, null,
    jsonb_build_object('definition', v_def.key, 'version', v_version.version,
                       'subject', p_subject_profile_id),
    'info'::public.btg_audit_severity,
    coalesce(v_def.audit_workflow, null));

  perform btg.advance_instance(v_instance.id);
  perform btg.enqueue_ready_steps(v_instance.id);

  select * into v_instance from public.workflow_instances where id = v_instance.id;
  return v_instance;
end;
$$;

-- -------------------------------------------------------- function grants ---
do $$ declare fn text;
begin
  foreach fn in array array[
    'btg.emit_orchestration_event(uuid, public.btg_orchestration_event, uuid, text, jsonb, integer, text, text)',
    'btg.enqueue_workflow_step(uuid, interval, text)',
    'btg.abandon_work_item(uuid, text)',
    'btg.enqueue_ready_steps(uuid)',
    'btg.invoke_domain_command(text, uuid, uuid)',
    'btg.signal_workflow_subject(uuid, text, uuid)',
    'btg.dispatch_workflow_work(text, integer, integer)',
    'btg.guard_step_command()'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

revoke all on function btg.start_workflow(text, uuid, uuid, text) from public;
revoke all on function btg.start_workflow(text, uuid, uuid, text) from anon;
revoke all on function btg.start_workflow(text, uuid, uuid, text) from authenticated;
grant execute on function btg.start_workflow(text, uuid, uuid, text) to service_role;

-- ------------------------------------------------------------------ seeds ---
/* `matching` v1: the first workflow with a real domain_command step, and the
   natural one -- recomputing matches is system work with its own authority,
   needs no actor, and is idempotent by upsert.

     skills_verified   await_domain_state   the learner has a live verified skill
     matches_computed  domain_command       compute_opportunity_matches, then
                                            re-verified against the domain */
insert into btg.workflow_checks (name, requires_subject_type, description) values
  ('learner_has_verified_skill', null,
   'The subject holds at least one verified skill that is neither revoked nor superseded.'),
  ('learner_has_opportunity_match', null,
   'The subject has at least one computed opportunity match.')
on conflict (name) do update set
  requires_subject_type = excluded.requires_subject_type,
  description = excluded.description;

create or replace function btg.assert_step_satisfied(
  p_check text,
  p_subject_type text,
  p_subject_id uuid,
  p_profile uuid
)
returns boolean language plpgsql stable security definer
set search_path = public, btg, pg_temp as $$
declare
  v_required text;
  v_ok boolean := false;
begin
  select requires_subject_type into v_required from btg.workflow_checks where name = p_check;
  if not found then
    raise exception 'unknown completion check %', p_check using errcode = '42501';
  end if;
  if v_required is not null and coalesce(p_subject_type, '') <> v_required then
    raise exception 'check % needs a % subject, got %',
      p_check, v_required, coalesce(p_subject_type, 'none')
      using errcode = 'check_violation';
  end if;

  case p_check
    when 'diagnostic_attempt_started' then
      select exists (
        select 1 from public.diagnostic_attempts a
        where a.id = p_subject_id and a.profile_id = p_profile) into v_ok;
    when 'diagnostic_attempt_scored' then
      select exists (
        select 1 from public.diagnostic_attempts a
        where a.id = p_subject_id and a.profile_id = p_profile
          and a.status = 'scored') into v_ok;
    when 'learner_baseline_recorded' then
      select exists (
        select 1 from public.learner_competencies lc
        where lc.profile_id = p_profile and lc.source = 'baseline') into v_ok;
    when 'learner_has_verified_skill' then
      select exists (
        select 1 from public.verified_skills vs
        where vs.profile_id = p_profile
          and vs.revoked_at is null and vs.superseded_by is null) into v_ok;
    when 'learner_has_opportunity_match' then
      select exists (
        select 1 from public.opportunity_matches om
        where om.profile_id = p_profile) into v_ok;
    else
      raise exception 'completion check % is registered but not implemented', p_check
        using errcode = '42501';
  end case;

  return v_ok;
end;
$$;

revoke all on function btg.assert_step_satisfied(text, text, uuid, uuid) from public;
revoke all on function btg.assert_step_satisfied(text, text, uuid, uuid) from anon;
revoke all on function btg.assert_step_satisfied(text, text, uuid, uuid) from authenticated;
grant execute on function btg.assert_step_satisfied(text, text, uuid, uuid) to service_role;

do $$
declare v_def uuid; v_version uuid;
begin
  select id into v_def from public.workflow_definitions where key = 'matching';

  if not exists (select 1 from public.workflow_definition_versions
                 where definition_id = v_def and status = 'published') then
    insert into public.workflow_definition_versions (definition_id, notes)
    values (v_def, 'W14-D: first published version. Awaits verification, then recomputes matches.')
    returning id into v_version;

    insert into public.workflow_definition_steps (
      definition_version_id, step_key, ordinal, item_type, handler,
      completion_check, domain_command, owner_kind, sla_hours, audit_workflow
    ) values
      (v_version, 'skills_verified', 1, 'system', 'await_domain_state',
       'learner_has_verified_skill', null, 'system', null, 'verification'),
      (v_version, 'matches_computed', 2, 'system', 'domain_command',
       'learner_has_opportunity_match', 'compute_opportunity_matches',
       'system', 24, 'matching');

    perform btg.publish_definition_version(v_version);
  end if;

  update public.workflow_definitions set is_enabled = true where key = 'matching';
end $$;
