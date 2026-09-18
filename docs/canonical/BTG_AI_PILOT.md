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
| G2 CI | PASS | both `verify` runs green on head `ec63983` |
| G3 migrations | PASS locally / BLOCKED live | 36 applied to a bare Postgres 16 with `ON_ERROR_STOP=1`, local and in CI; no live project connected |
| G4 live auth | BLOCKED | no Supabase project designated for BTG AI |
| G5 live RLS | PASS locally / BLOCKED live | 193 database tests as the `authenticated` role with `auth.uid()` from the request claim; unexercised through PostgREST |
| G6 authenticated E2E | BLOCKED | 7 browser specs written, skipped for want of Supabase |
| G7 object storage | BLOCKED | certified by contract against `file_objects`; no object uploaded or retrieved |
| G8 core learner journey | PASS locally / BLOCKED live | `tests/db/journey.test.ts`, sign-up to accepted offer through real commands |
| G9 reviewer workflow | PASS locally / BLOCKED live | 28 verification tests; rubric-bound decision, self-review refused |
| G10 employer workflow | PASS locally / BLOCKED live | 24 outcome/pipeline tests; disclosure-scoped applicant visibility |
| G11 responsive UI | PASS for the landing / BLOCKED for the app | landing certified at 1440/1280/834/390; the authenticated surface has never been rendered against a live session |
| G12 audit trail | PASS | every governed transition carries actor, object, before, after, severity, workflow, `clock_timestamp()` ordering |
| G13 error recovery | PASS locally | typed `ActionState` per failure; unhappy paths covered in the domain and database suites |
| G14 no critical security defect | PASS | see the defect ledger; the cohort RLS recursion below was the last one found |
| G15 no data-loss defect | PASS | append-only ledger and transcript; supersession never rewrites a prior claim |

**Overall: `NOT_PILOT_READY` — blocked on live infrastructure, not on product.**
Every gate that can be closed without a live Supabase project is closed. G4, G6
and G7 cannot be assessed at all from here, and G11 only partially.
