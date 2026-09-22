import "server-only";

/**
 * E16 — there is deliberately no application-side write path into the audit
 * ledger.
 *
 * `public.record_audit_event` is SECURITY DEFINER and is called from inside
 * every governed command, which is where a lifecycle fact is actually known.
 * A client-callable wrapper used to live here with no callers, and the matching
 * grant let any authenticated session write arbitrary actions into the ledger
 * at any severity — including the lifecycle actions `outcome_timeline_view`
 * reads, so a learner could write themselves a history. Migration
 * 20260918003800 revoked that grant; see tests/db/grants.test.ts.
 *
 * If a future surface genuinely needs to record something, add a narrow
 * command for it in SQL that validates its own action namespace, rather than
 * re-opening the general one.
 */
export {};
