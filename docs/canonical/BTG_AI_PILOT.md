# BTG AI — Pilot Readiness

Companion to `BTG_AI_STATUS.md`. This file records the scope decisions a pilot
forces, and the go/no-go gates. Gate statuses are `PASS`, `BLOCKED` or `FAIL`
only — never a score.

## Scope decisions

### E14 Community — `PILOT_SCOPE_COMPLETE`

Cohort aggregation **is** the intended pilot scope. The pilot's proposition is
skill → evidence → human verification → opportunity; peer discussion is not
load-bearing for any of it, and a discussion surface would add a moderation and
safety burden that nothing in the pilot needs. The institution persona's pilot
requirement — "is my cohort progressing?" — is served by `cohort_outcomes` and
the organization panel.

Reversible: a peer surface can be added later without touching the engines.
This closes the previous ambiguous `READY_WITH_GAPS`.

### E17 organization read surface — `PILOT_SCOPE_COMPLETE`

`cohort_outcomes` was certified but unconsumed. The smallest useful governed
surface now exists on `/organizations`, behind `outcomes.read_org`: it lists the
cohorts the caller governs and the aggregate for each. No per-learner row is
fetched or rendered, because the function does not return one, and a cohort the
database refuses to report says why instead of showing zeros that would read as
"nobody is progressing".

A broader operator console (`/console/*`, cross-organization analytics,
exports) is **`POST_PILOT`**. No BI product was built to close a checkbox.

### Pre-authentication analytics — `POST_PILOT`

`landing_viewed` and `join_started` have no authenticated actor. **Option B:
deferred.** Forcing them through the audit ledger would corrupt a ledger whose
integrity rests on every row carrying an actor stamped from `auth.uid()`, and
doing it properly needs an anonymous-writable table with its own rate limiting
and abuse controls — a surface with real attack exposure, built for marketing
instrumentation that no pilot decision depends on. Deferred deliberately, not
overlooked.

## Go/no-go gates

| Gate | Status | Evidence |
|---|---|---|
| G1 build | PASS | `npm run build`, `/` prerendered static |
| G2 CI | PASS | both `verify` runs green on the current head |
| G3 migrations | PASS | 39/39 applied to live project `epmtfqqemxumsjbthsmq` and recorded in its ledger in order; ten-section fingerprint identical to the local certified cluster, re-proved after each fix |
| G4 live auth | BLOCKED_EXTERNAL | Auth provisioned and the `on_auth_user_created` trigger installed live, but this session's egress policy denies `epmtfqqemxumsjbthsmq.supabase.co` (403 on CONNECT), so no sign-up can be exercised from here |
| G5 live RLS / PostgREST | BLOCKED_EXTERNAL | Policies, grants and function ACLs byte-identical live; every denial re-proved on the live database as the `authenticated` role with a session claim. The PostgREST/JWT path itself is unreachable from this session |
| G6 authenticated E2E | BLOCKED_EXTERNAL | 7 browser specs written and still skipped; the browser cannot reach the project host |
| G7 storage | BLOCKED_EXTERNAL | no object uploaded or retrieved; Storage is served from the blocked host |
| G8 core learner journey | PASS (local) / BLOCKED_EXTERNAL (live) | `tests/db/journey.test.ts`, sign-up to accepted offer through real commands |
| G9 reviewer workflow | PASS (local) / BLOCKED_EXTERNAL (live) | 28 verification tests; rubric-bound decision, self-review refused |
| G10 employer workflow | PASS (local) / BLOCKED_EXTERNAL (live) | 24 outcome/pipeline tests; disclosure-scoped applicant visibility |
| G11 responsive app UI | PASS (landing) / BLOCKED_EXTERNAL (app) | landing certified at 1440/1280/834/390; the authenticated surface has still never been rendered against a live session |
| G12 audit | PASS | every governed transition carries actor, object, before, after, severity, workflow, `clock_timestamp()` ordering — and the ledger is now writable only from inside a governed command |
| G13 recovery | PASS (local) | typed `ActionState` per failure; unhappy paths covered in the domain and database suites |
| G14 no critical security defect | PASS, after two repairs | defect 15 (any learner could complete any learner's pathway step) and defect 17 (any learner could forge their own outcome history in the ledger). Both reproduced with probes, fixed, and guarded by 19 grant-surface tests |
| G15 no data-loss defect | PASS | append-only ledger and transcript; supersession never rewrites a prior claim |
| G16 notification delivery | PASS (local) / BLOCKED_EXTERNAL (live) | W14-B execution tier: `pending → sent` is a registered transition driven by a real worker, 16 execution tests. Live drain is unwired — the invoker needs a service-role key this session cannot hold |

**Overall: `NOT_PILOT_READY`.**

Every gate that can be closed without reaching the project host over the
network is closed, and the database tier is certified live and provably
identical to the certified local schema. W14-B closed the one gap that was a
repository defect rather than an environment limit: notifications now have a
worker that delivers them (`BTG_AI_WORKFLOW_OS.md`). But G4, G6 and G7 are
pilot-critical and have never been exercised: nobody has loaded an authenticated page against
live infrastructure, and no file has been uploaded. Calling that pilot-ready
would be a claim the evidence does not support, so it is not made.

## External blockers

1. **Egress policy (the one that matters).** This session's proxy denies
   `epmtfqqemxumsjbthsmq.supabase.co:443` with a 403 on CONNECT, recorded as a
   policy denial. The proxy documentation is explicit that this must be
   reported rather than routed around. Everything Auth, PostgREST, Storage and
   browser-based therefore cannot run from here — not because of a repository
   defect, but because the host is outside this environment's allow-list. The
   work is otherwise ready: `.env.local` is configured against the live project
   and gitignored, and the 7 browser specs need only a reachable host.
2. **No `ANTHROPIC_API_KEY`.** Live tutor-provider certification stays
   `BLOCKED_EXTERNAL`. The deterministic tutor safety boundary — screening,
   refusal, schema validation, overclaim guard, provider-unavailable fallback —
   is green without it.
3. **No service-role key in this session.** The W14-B drain function is
   `service_role`-only by design, so nothing in this session may invoke it on
   a schedule. The queue, worker and dead-letter behaviour are certified; the
   *invoker* (a cron job, an edge function, or a scheduled task holding the
   key) is deployment configuration, not repository code, and is listed as a
   deployment step rather than claimed as done.
4. **Supabase free-tier project limit** (2 active projects, both occupied) —
   already worked around by using the empty project rather than touching the
   unrelated live one.
