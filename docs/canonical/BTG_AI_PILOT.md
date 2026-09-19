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
| G2 CI | PASS | both `verify` runs green on head `89033c8` |
| G3 migrations | PASS | 37/37 applied to live project `epmtfqqemxumsjbthsmq` and recorded in its ledger in order; ten-section fingerprint identical to the local certified cluster |
| G4 live auth | BLOCKED | Auth is provisioned and the `on_auth_user_created` trigger is installed live, but no real sign-up has been exercised |
| G5 live RLS | PASS (schema) / BLOCKED (exercised) | Policies and grants are byte-identical live; 203 database tests exercise them as the `authenticated` role with `auth.uid()` from the request claim. Not yet exercised through PostgREST with a real JWT |
| G6 authenticated E2E | BLOCKED | 7 browser specs written, still skipped: the app is not yet wired to the live project |
| G7 object storage | BLOCKED | certified by contract against `file_objects`; no object uploaded or retrieved |
| G8 core learner journey | PASS (local) / BLOCKED (live) | `tests/db/journey.test.ts`, sign-up to accepted offer through real commands |
| G9 reviewer workflow | PASS (local) / BLOCKED (live) | 28 verification tests; rubric-bound decision, self-review refused |
| G10 employer workflow | PASS (local) / BLOCKED (live) | 24 outcome/pipeline tests; disclosure-scoped applicant visibility |
| G11 responsive UI | PASS (landing) / BLOCKED (app) | landing certified at 1440/1280/834/390; the authenticated surface has never been rendered against a live session |
| G12 audit trail | PASS | every governed transition carries actor, object, before, after, severity, workflow, `clock_timestamp()` ordering |
| G13 error recovery | PASS (local) | typed `ActionState` per failure; unhappy paths covered in the domain and database suites |
| G14 no critical security defect | PASS, after repair | defect 15 (any learner could complete any learner's pathway step via `btg.complete_pathway_step`) was found during live certification, reproduced with a probe, fixed, and is now guarded by 10 grant-surface tests. It was present locally too |
| G15 no data-loss defect | PASS | append-only ledger and transcript; supersession never rewrites a prior claim |

**Overall: `NOT_PILOT_READY`.** The database tier is now live-certified and
provably identical to the certified local schema, and the one critical defect
found is fixed. What remains is exercising the live stack through the
application: real Auth sign-up, RLS through PostgREST, the 7 browser specs,
object storage, and the responsive pass over the authenticated surface. None of
those are blocked by anything outside the repository any more — they are the
next batch of work, not an external blocker.

The one genuine external blocker left is AI-provider credentials: no
`ANTHROPIC_API_KEY` is present, so live tutor-provider certification stays
`READY_WITH_EXTERNAL_BLOCKER`. The deterministic tutor path — screening,
refusal, schema validation, overclaim guard, provider-unavailable fallback — is
certified without it.
