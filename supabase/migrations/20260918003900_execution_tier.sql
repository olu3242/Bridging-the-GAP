-- W14-B: the execution tier.
--
-- Until now BTG had no capacity to do anything asynchronously. btg.notify
-- wrote rows into public.notifications and nothing ever delivered them: in 38
-- migrations and the whole application, nothing set status = 'sent'. Every
-- notification ever created sat 'pending' forever, and the only reference to
-- 'sent' was an index predicate. Orchestration, retries, timers and human
-- queues all presuppose something that can run; this is that something.
--
-- TECHNOLOGY NOTE. The plan called for pgmq + pg_cron. Neither is available on
-- a bare Postgres cluster -- not merely uninstalled, absent from
-- pg_available_extensions -- and the local certification cluster and CI both
-- run bare postgres:16. A pgmq queue would therefore have had no test coverage
-- in the only environment that currently works, and could only ever be
-- exercised against a hosted project. This is a plain-SQL claim/lease queue
-- using FOR UPDATE SKIP LOCKED instead: the same semantics, portable across
-- both, testable in CI, and it still enqueues inside the same transaction as
-- the domain write, which is the property that makes in-database orchestration
-- worth choosing over an external orchestrator.
--
-- pg_cron is not required. It becomes one possible *invoker* of the drain, not
-- the queue itself, so the choice of scheduler stays open.
--
-- Nothing here is granted to `authenticated` or `anon`. Given that two
-- defects in this codebase were over-broad grants on functions meant to be
-- internal, the whole runtime is service_role-only by construction.

do $$ begin
  create type btg.work_status as enum ('queued','claimed','done','failed','dead');
exception when duplicate_object then null; end $$;

create table if not exists btg.work_queue (
  id bigserial primary key,
  queue text not null check (queue ~ '^[a-z0-9_]{2,40}$'),
  payload jsonb not null default '{}'::jsonb,
  /* Present makes enqueue idempotent for a repeated domain event. */
  idempotency_key text,
  status btg.work_status not null default 'queued',
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  /* Backoff and scheduling: nothing is claimable before this. */
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_queue_claim_consistency check (
    (status = 'claimed') = (claimed_by is not null and lease_until is not null)
  )
);
comment on table btg.work_queue is
  'W14-B: durable work queue. Claim/lease via FOR UPDATE SKIP LOCKED, so several workers can drain one queue safely.';

create unique index if not exists work_queue_idempotent
  on btg.work_queue (queue, idempotency_key) where idempotency_key is not null;
create index if not exists work_queue_claimable
  on btg.work_queue (queue, available_at, id) where status = 'queued';
create index if not exists work_queue_leases
  on btg.work_queue (lease_until) where status = 'claimed';

drop trigger if exists work_queue_touch on btg.work_queue;
create trigger work_queue_touch before update on btg.work_queue
  for each row execute function btg.touch_updated_at();

-- ------------------------------------------------------------- enqueue ---
create or replace function btg.enqueue_work(
  p_queue text,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_available_at timestamptz default now(),
  p_max_attempts int default 5
)
returns bigint
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_id bigint;
begin
  insert into btg.work_queue (queue, payload, idempotency_key, available_at, max_attempts)
  values (p_queue, coalesce(p_payload, '{}'::jsonb), p_idempotency_key,
          coalesce(p_available_at, now()), p_max_attempts)
  on conflict (queue, idempotency_key) where idempotency_key is not null
    do nothing
  returning id into v_id;

  if v_id is null and p_idempotency_key is not null then
    select id into v_id from btg.work_queue
    where queue = p_queue and idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end;
$$;

-- --------------------------------------------------------------- claim ---
/* One statement, so two workers cannot claim the same row: the subquery locks
   candidate rows and skips any already locked. attempts increments at claim
   time on purpose -- a worker that dies mid-item must still burn an attempt,
   or a poison item retries forever. */
create or replace function btg.claim_work(
  p_queue text,
  p_worker text,
  p_lease_seconds int default 60,
  p_batch int default 10
)
returns setof btg.work_queue
language plpgsql security definer set search_path = public, btg, pg_temp as $$
begin
  return query
  update btg.work_queue q
  set status = 'claimed',
      attempts = q.attempts + 1,
      claimed_at = now(),
      claimed_by = p_worker,
      lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
  where q.id in (
    select c.id from btg.work_queue c
    where c.queue = p_queue and c.status = 'queued' and c.available_at <= now()
    order by c.available_at, c.id
    for update skip locked
    limit greatest(p_batch, 1)
  )
  returning q.*;
end;
$$;

-- ------------------------------------------------------ complete / fail ---
create or replace function btg.complete_work(p_id bigint)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
begin
  update btg.work_queue
  set status = 'done', claimed_by = null, lease_until = null, last_error = null
  where id = p_id;
end;
$$;

/* Retryable failure: exponential backoff, then dead-letter at max_attempts.
   Returns the resulting status so a caller can react to exhaustion. */
create or replace function btg.fail_work(p_id bigint, p_error text)
returns btg.work_status
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_item btg.work_queue; v_next btg.work_status;
begin
  select * into v_item from btg.work_queue where id = p_id for update;
  if not found then return null; end if;

  if v_item.attempts >= v_item.max_attempts then
    v_next := 'dead';
    update btg.work_queue
    set status = 'dead', claimed_by = null, lease_until = null, last_error = p_error
    where id = p_id;
  else
    v_next := 'queued';
    update btg.work_queue
    set status = 'queued', claimed_by = null, lease_until = null, last_error = p_error,
        -- 5s, 10s, 20s, 40s ... capped at an hour.
        available_at = now() + make_interval(
          secs => least(3600, 5 * power(2, greatest(v_item.attempts - 1, 0))::int))
    where id = p_id;
  end if;
  return v_next;
end;
$$;

/* Not-retryable failure. Classified separately because retrying a permanent
   condition -- a channel with no configured provider, a malformed payload --
   only delays the dead-letter and burns attempts for nothing. */
create or replace function btg.fail_work_permanently(p_id bigint, p_error text)
returns void language plpgsql security definer set search_path = public, btg, pg_temp as $$
begin
  update btg.work_queue
  set status = 'dead', claimed_by = null, lease_until = null, last_error = p_error
  where id = p_id;
end;
$$;

/* A worker that dies holding a lease must not strand its item. */
create or replace function btg.reap_expired_leases()
returns int language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_count int;
begin
  with expired as (
    update btg.work_queue
    set status = 'queued', claimed_by = null, lease_until = null,
        last_error = coalesce(last_error, 'lease expired; requeued')
    where status = 'claimed' and lease_until < now()
    returning 1
  )
  select count(*) into v_count from expired;
  return coalesce(v_count, 0);
end;
$$;

-- --------------------------------------------- first workload: notifications ---
-- A notification lifecycle needs the same explicit transitions as every other
-- state in the system; it was the one status enum with no machine registered.
insert into btg.state_transitions (machine, from_state, to_state) values
  ('notification','pending','sent'),
  ('notification','pending','failed'),
  ('notification','pending','read'),   -- in-app read before the drain ran
  ('notification','sent','read'),
  ('notification','failed','pending')  -- manual retry
on conflict do nothing;

drop trigger if exists notifications_enforce_transition on public.notifications;
create trigger notifications_enforce_transition
  before update of status on public.notifications
  for each row execute function btg.enforce_transition('notification', 'status');

/* Every notification is queued for dispatch, whatever wrote it. Idempotent on
   the notification id, so a replay cannot double-deliver. */
create or replace function btg.on_notification_created()
returns trigger language plpgsql security definer
set search_path = public, btg, pg_temp as $$
begin
  perform btg.enqueue_work(
    'notifications',
    jsonb_build_object('notification_id', new.id, 'channel', new.channel),
    'notification:' || new.id::text);
  return null;
end;
$$;

drop trigger if exists notifications_enqueue_dispatch on public.notifications;
create trigger notifications_enqueue_dispatch
  after insert on public.notifications
  for each row execute function btg.on_notification_created();

/* Dispatch one notification.
   in_app: the row being readable *is* delivery, so this records when dispatch
   observed it and moves pending -> sent.
   email / push: there is no configured delivery provider in this deployment.
   That is a permanent condition, not a transient one, so it dead-letters with
   a reason instead of retrying five times and pretending to have tried. */
create or replace function btg.dispatch_notification(p_notification_id uuid)
returns text language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare v_notification public.notifications;
begin
  select * into v_notification from public.notifications
  where id = p_notification_id for update;
  if not found then return 'missing'; end if;
  if v_notification.status <> 'pending' then
    -- Already read or already handled; nothing to deliver.
    return 'skipped';
  end if;

  if v_notification.channel = 'in_app' then
    update public.notifications set status = 'sent', sent_at = now()
    where id = p_notification_id;
    return 'sent';
  end if;

  return 'no_provider';
end;
$$;

/* The worker. Claims a batch, dispatches each, and records the outcome.
   Returns a summary so an invoker can log or alert on it. */
create or replace function btg.drain_notifications(
  p_worker text default 'default',
  p_batch int default 25,
  p_lease_seconds int default 60
)
returns table (claimed int, sent int, skipped int, dead int)
language plpgsql security definer set search_path = public, btg, pg_temp as $$
declare
  v_item btg.work_queue;
  v_outcome text;
  v_claimed int := 0; v_sent int := 0; v_skipped int := 0; v_dead int := 0;
begin
  perform btg.reap_expired_leases();

  for v_item in select * from btg.claim_work('notifications', p_worker, p_lease_seconds, p_batch)
  loop
    v_claimed := v_claimed + 1;
    begin
      v_outcome := btg.dispatch_notification((v_item.payload->>'notification_id')::uuid);

      if v_outcome = 'sent' then
        perform btg.complete_work(v_item.id);
        v_sent := v_sent + 1;
      elsif v_outcome in ('skipped','missing') then
        -- Nothing to do and nothing wrong: not a failure.
        perform btg.complete_work(v_item.id);
        v_skipped := v_skipped + 1;
      else
        perform btg.fail_work_permanently(v_item.id,
          format('no delivery provider configured for channel %s', v_item.payload->>'channel'));
        update public.notifications set status = 'failed'
        where id = (v_item.payload->>'notification_id')::uuid and status = 'pending';
        v_dead := v_dead + 1;
      end if;
    exception when others then
      -- An unexpected error is treated as transient and retried with backoff.
      perform btg.fail_work(v_item.id, left(SQLERRM, 500));
    end;
  end loop;

  return query select v_claimed, v_sent, v_skipped, v_dead;
end;
$$;

-- --------------------------------------------------------- observability ---
create or replace view btg.queue_health as
select
  queue,
  status,
  count(*) as items,
  min(available_at) filter (where status = 'queued') as next_available_at,
  max(attempts) as max_attempts_seen,
  (now() - min(created_at) filter (where status = 'queued')) as oldest_queued_age
from btg.work_queue
group by queue, status;

comment on view btg.queue_health is
  'W14-B: per-queue depth, backlog age and retry pressure. The one place to look when asking whether the runtime is keeping up.';

-- ---------------------------------------------------------------- grants ---
-- The runtime is not part of the authenticated API surface. Everything here is
-- service_role only, and PUBLIC's default EXECUTE is revoked explicitly rather
-- than assumed absent.
revoke all on btg.work_queue from public, anon, authenticated;
revoke all on btg.queue_health from public, anon, authenticated;
grant select, insert, update on btg.work_queue to service_role;
grant usage, select on sequence btg.work_queue_id_seq to service_role;
grant select on btg.queue_health to service_role;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'btg'
      and p.proname in ('enqueue_work','claim_work','complete_work','fail_work',
                        'fail_work_permanently','reap_expired_leases',
                        'dispatch_notification','drain_notifications',
                        'on_notification_created')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
