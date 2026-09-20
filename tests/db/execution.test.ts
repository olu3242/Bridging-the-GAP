import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asAnon, asUser, createUser, expectRejection, sql, walkBaseline } from "./helpers";

/**
 * Every db test file shares one database, so the notification queue is never
 * empty and an idempotency key survives between runs. Tests therefore key on a
 * per-run nonce and assert on their own item, never on a global counter.
 */
const nonce = () => randomUUID().slice(0, 8);

/** The runtime is service_role-only, so tests drive it as the owner. */
async function drain(worker = "test") {
  const [row] = await sql<{ claimed: number; sent: number; skipped: number; dead: number }>(
    "select * from btg.drain_notifications($1, 200, 60)",
    [worker],
  );
  return {
    claimed: Number(row.claimed),
    sent: Number(row.sent),
    skipped: Number(row.skipped),
    dead: Number(row.dead),
  };
}

/** Drains until this notification's queue item reaches a terminal state. */
async function drainUntilSettled(notificationId: string): Promise<string> {
  for (let i = 0; i < 10; i += 1) {
    const [item] = await sql<{ status: string }>(
      "select status from btg.work_queue where idempotency_key = $1",
      [`notification:${notificationId}`],
    );
    if (item && (item.status === "done" || item.status === "dead")) return item.status;
    await drain(`settle-${i}`);
  }
  throw new Error("queue item never settled");
}

describe("the queue claims work exactly once", () => {
  it("enqueues idempotently on a key", async () => {
    const key = `dup-${nonce()}`;
    const first = await sql<{ id: string }>(
      "select btg.enqueue_work('testq', '{\"a\":1}'::jsonb, $1) as id",
      [key],
    );
    const second = await sql<{ id: string }>(
      "select btg.enqueue_work('testq', '{\"a\":2}'::jsonb, $1) as id",
      [key],
    );
    expect(second[0].id).toBe(first[0].id);
    const [{ n }] = await sql<{ n: string }>(
      "select count(*)::text as n from btg.work_queue where idempotency_key = $1",
      [key],
    );
    expect(Number(n)).toBe(1);
  });

  it("never hands the same item to two workers", async () => {
    // A dedicated queue name keeps this independent of other tests' items.
    const queue = `q_${nonce()}`;
    await sql("select btg.enqueue_work($1, '{}'::jsonb, 'claim-once')", [queue]);
    const a = await sql<{ id: string }>("select id from btg.claim_work($1, 'worker-a', 60, 10)", [queue]);
    const b = await sql<{ id: string }>("select id from btg.claim_work($1, 'worker-b', 60, 10)", [queue]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it("burns an attempt at claim time, so a poison item cannot retry forever", async () => {
    const queue = `q_${nonce()}`;
    await sql("select btg.enqueue_work($1, '{}'::jsonb, 'poison')", [queue]);
    await sql("select btg.claim_work($1, 'w', 60, 10)", [queue]);
    const [row] = await sql<{ attempts: number }>(
      "select attempts from btg.work_queue where queue = $1",
      [queue],
    );
    expect(Number(row.attempts)).toBe(1);
  });

  it("backs off on a retryable failure and dead-letters at the ceiling", async () => {
    const queue = `q_${nonce()}`;
    const [{ id }] = await sql<{ id: string }>(
      "select btg.enqueue_work($1, '{}'::jsonb, 'backoff', now(), 2) as id",
      [queue],
    );
    // Attempt 1: claim it, then fail it -> requeued with backoff.
    await sql("select btg.claim_work($1, 'w', 60, 1)", [queue]);
    await sql("select btg.fail_work($1, 'boom')", [id]);
    const [first] = await sql<{ status: string; available_at: string }>(
      "select status, available_at from btg.work_queue where id = $1",
      [id],
    );
    expect(first.status).toBe("queued");
    // Wait is in the future, so it is not immediately claimable again.
    const [{ claimable }] = await sql<{ claimable: boolean }>(
      "select (available_at > now()) as claimable from btg.work_queue where id = $1",
      [id],
    );
    expect(claimable).toBe(true);

    // Force it due, then exhaust the ceiling: attempt 2 of max 2.
    await sql("update btg.work_queue set available_at = now() where id = $1", [id]);
    await sql("select btg.claim_work($1, 'w', 60, 1)", [queue]);
    await sql("select btg.fail_work($1, 'boom again')", [id]);
    const [dead] = await sql<{ status: string; last_error: string }>(
      "select status, last_error from btg.work_queue where id = $1",
      [id],
    );
    expect(dead.status).toBe("dead");
    expect(dead.last_error).toContain("boom again");
  });

  it("requeues an item whose worker died holding the lease", async () => {
    const queue = `q_${nonce()}`;
    await sql("select btg.enqueue_work($1, '{}'::jsonb, 'stranded')", [queue]);
    await sql("select btg.claim_work($1, 'crashed-worker', 60, 1)", [queue]);
    await sql(
      "update btg.work_queue set lease_until = now() - interval '1 minute' where queue = $1",
      [queue],
    );
    const [{ reaped }] = await sql<{ reaped: string }>("select btg.reap_expired_leases()::text as reaped");
    expect(Number(reaped)).toBeGreaterThanOrEqual(1);
    const [row] = await sql<{ status: string; claimed_by: string | null }>(
      "select status, claimed_by from btg.work_queue where queue = $1",
      [queue],
    );
    expect(row.status).toBe("queued");
    expect(row.claimed_by).toBeNull();
  });
});

describe("notifications actually get delivered", () => {
  it("moves an in-app notification from pending to sent", async () => {
    const learner = await createUser("dispatch-learner");
    await walkBaseline(learner.id, { correctly: false });

    const [before] = await sql<{ status: string; sent_at: string | null }>(
      "select status, sent_at from public.notifications where profile_id = $1 limit 1",
      [learner.id],
    );
    expect(before.status).toBe("pending");
    expect(before.sent_at).toBeNull();

    const [own] = await sql<{ id: string }>(
      "select id from public.notifications where profile_id = $1 limit 1",
      [learner.id],
    );
    expect(await drainUntilSettled(own.id)).toBe("done");

    const [after] = await sql<{ status: string; sent_at: string | null }>(
      "select status, sent_at from public.notifications where id = $1",
      [own.id],
    );
    expect(after.status).toBe("sent");
    expect(after.sent_at).not.toBeNull();
  });

  it("enqueues every notification a governed command writes", async () => {
    const learner = await createUser("enqueue-learner");
    await walkBaseline(learner.id, { correctly: false });
    const [{ n }] = await sql<{ n: string }>(
      `select count(*)::text as n from btg.work_queue
       where queue = 'notifications'
         and idempotency_key = 'notification:' || (
           select id::text from public.notifications where profile_id = $1 limit 1)`,
      [learner.id],
    );
    expect(Number(n)).toBe(1);
  });

  it("dead-letters a channel with no provider instead of pretending to retry", async () => {
    const learner = await createUser("email-learner");
    const key = `email-${nonce()}`;
    const [created] = await sql<{ id: string }>(
      `insert into public.notifications (profile_id, channel, category, title, dedupe_key)
       values ($1, 'email', 'test.email', 'Email test', $2) returning id`,
      [learner.id, key],
    );
    expect(await drainUntilSettled(created.id)).toBe("dead");

    const [item] = await sql<{ status: string; attempts: number; last_error: string }>(
      "select status, attempts, last_error from btg.work_queue where idempotency_key = $1",
      [`notification:${created.id}`],
    );
    // Permanent, so it did not burn the whole retry budget first.
    expect(Number(item.attempts)).toBe(1);
    expect(item.last_error).toContain("no delivery provider");

    const [notification] = await sql<{ status: string }>(
      "select status from public.notifications where id = $1",
      [created.id],
    );
    expect(notification.status).toBe("failed");
  });

  it("is idempotent across repeated drains", async () => {
    const learner = await createUser("redrain-learner");
    await walkBaseline(learner.id, { correctly: false });
    const [own] = await sql<{ id: string }>(
      "select id from public.notifications where profile_id = $1 limit 1",
      [learner.id],
    );
    await drainUntilSettled(own.id);
    await drain("redrain-again");
    // The item is terminal, so a second pass cannot claim or re-send it.
    const [item] = await sql<{ status: string; attempts: number }>(
      "select status, attempts from btg.work_queue where idempotency_key = $1",
      [`notification:${own.id}`],
    );
    expect(item.status).toBe("done");
    expect(Number(item.attempts)).toBe(1);
    const [notification] = await sql<{ status: string; sent_at: string }>(
      "select status, sent_at from public.notifications where id = $1",
      [own.id],
    );
    expect(notification.status).toBe("sent");
  });

  it("does not resurrect a notification the learner already read", async () => {
    const learner = await createUser("read-first-learner");
    await walkBaseline(learner.id, { correctly: false });
    const [notification] = await sql<{ id: string }>(
      "select id from public.notifications where profile_id = $1 limit 1",
      [learner.id],
    );
    await asUser(learner.id, (client) =>
      client.query("select public.mark_notification_read($1)", [notification.id]),
    );
    await drainUntilSettled(notification.id);
    const [row] = await sql<{ status: string }>(
      "select status from public.notifications where id = $1",
      [notification.id],
    );
    expect(row.status).toBe("read");
  });

  it("registers notification status in the one transition registry", async () => {
    const rows = await sql<{ from_state: string; to_state: string }>(
      "select from_state, to_state from btg.state_transitions where machine = 'notification' order by 1,2",
    );
    expect(rows.length).toBeGreaterThan(0);
    const rejection = await expectRejection(
      sql("update public.notifications set status = 'pending' where status = 'sent'"),
    );
    expect(rejection.message).toMatch(/invalid notification transition/i);
  });
});

describe("the runtime is not part of the authenticated API surface", () => {
  const RUNTIME_FUNCTIONS = [
    "enqueue_work",
    "claim_work",
    "complete_work",
    "fail_work",
    "fail_work_permanently",
    "reap_expired_leases",
    "dispatch_notification",
    "drain_notifications",
    "on_notification_created",
  ];

  it("grants no session role EXECUTE on any runtime function", async () => {
    const rows = await sql<{ fn: string; anon: boolean; authed: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'btg' and p.proname = any($1)`,
      [RUNTIME_FUNCTIONS],
    );
    expect(rows).toHaveLength(RUNTIME_FUNCTIONS.length);
    for (const row of rows) {
      expect(row.anon, `anon may execute btg.${row.fn}`).toBe(false);
      expect(row.authed, `authenticated may execute btg.${row.fn}`).toBe(false);
    }
  });

  it("grants no session role any access to the queue itself", async () => {
    const rows = await sql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'btg' and table_name in ('work_queue','queue_health')
         and grantee in ('anon','authenticated')`,
    );
    expect(rows).toEqual([]);
  });

  it("refuses a learner reading or draining the queue", async () => {
    const learner = await createUser("queue-prober");
    const read = await expectRejection(
      asUser(learner.id, (client) => client.query("select count(*) from btg.work_queue")),
    );
    expect(read.code).toBe("42501");
    const run = await expectRejection(
      asUser(learner.id, (client) => client.query("select btg.drain_notifications('evil', 1, 1)")),
    );
    expect(run.code).toBe("42501");
  });

  it("refuses an anonymous caller entirely", async () => {
    const rejection = await expectRejection(
      asAnon((client) => client.query("select count(*) from btg.work_queue")),
    );
    expect(rejection.code).toBe("42501");
  });

  it("pins search_path on every runtime function", async () => {
    const rows = await sql<{ fn: string }>(
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'btg' and p.proname = any($1)
         and (p.proconfig is null or not exists (
               select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`,
      [RUNTIME_FUNCTIONS],
    );
    expect(rows.map((r) => r.fn)).toEqual([]);
  });
});
