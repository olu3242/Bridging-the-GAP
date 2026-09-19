# BTG AI — Status Ledger

Status vocabulary: `NOT_STARTED`, `DESIGNED`, `SCHEMA_READY`, `BACKEND_READY`,
`UI_READY`, `INTEGRATED`, `E2E_PASS`, `LIVE_CERTIFIED`, `BLOCKED`.

## W01 — Platform Foundation

```
Wave:            W01 — Platform Foundation
Status:          INTEGRATED
Certification:   BTG_W01_FOUNDATION_READY (pending live Supabase for LIVE_CERTIFIED)
Commit/SHA:      see branch claude/intelligent-fermat-3yzjca
Schema:          9 migrations, 20260918000100 → 20260918000900
Implementation:  E1 identity/access, E2 minimum (onboarding goals), E16 audit +
                 notification foundation, file registry, app shell, dashboard,
                 onboarding flow, organization provisioning
Tests:           75/75 vitest (35 domain, 40 database/RLS) + 5/5 Playwright on
                 the public surface; 2 golden-journey specs skipped
Failures:        none
Defects repaired: 3 (see below)
External blockers: Supabase project not provisioned for BTG AI, so the
                 signup → onboarding → dashboard browser journey is written but
                 unrun, and nothing is LIVE_CERTIFIED
Next execution:  02 — W02 Diagnostic + Competency Graph, Batch A+B
```

### Defects found and repaired in W01

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 1 | `complete_onboarding_step('profile')` rejected for every new learner | Command jumped `not_started → persona`, which the transition registry forbids | Command now enters onboarding explicitly (`not_started → profile`) before advancing; the registry stays authoritative |
| 2 | Onboarding audit write failed to resolve `record_audit_event` | A `CASE` expression passed `text` where `btg_audit_severity` was expected | Explicit cast at both call sites |
| 3 | Audit events raised in one transaction were unorderable | `occurred_at` defaulted to `now()`, identical across a transaction | Default changed to `clock_timestamp()` |

### Engine coverage

| Engine | Status |
|---|---|
| E1 Identity & Access | `INTEGRATED` |
| E2 Learner Profile | `SCHEMA_READY` (goals only; W02 extends) |
| E16 Governance | `INTEGRATED` (audit, notifications); observability beyond structured logs is W10 |
| E3–E15 | `NOT_STARTED` |

## Landing convergence (post-W01)

```
Scope:           Canonical landing port + landing→product convergence
Status:          INTEGRATED
Schema:          +1 forward migration (20260918001000_journey_lifecycle)
Implementation:  btg-ai-landing/index.html ported to src/app/(marketing) +
                 src/components/landing/*; static redirect and the duplicated
                 public/btg-landing/ copy removed; assets under public/images,
                 public/icons, public/brand; journey resolver routes by
                 persisted state; partner CTAs carry a persona intent
Tests:           83/83 vitest, 14/14 Playwright (4 skipped: need Supabase)
Visual:          Section-for-section pixel match against the canonical at
                 1440/1280/834/390 with fonts held equal. One deliberate
                 deviation, see below
Defects repaired: 2 (font token scope, button line-height)
External blockers: Supabase project still unprovisioned
Next execution:  02 — W02 Diagnostic + Competency Graph, Batch A+B
```

### Deliberate deviation from the canonical design

`btg-ai-landing/css/style.css` resets `ul` but not `ol`, so the canonical page
renders the browser's own `1.` … `5.` list markers outside the five step cards,
next to the designed numbered circles, and indents the steps row 40px out of
alignment with its section heading. The port does not reproduce this. To
restore canonical behaviour exactly, add to
`src/app/(marketing)/landing.css`:

```css
.steps { padding-inline-start: 40px; list-style: decimal; }
```

### Environment note

The canonical HTML loads Inter and Space Grotesk from Google Fonts. That
request fails inside this container (`ERR_CERT_AUTHORITY_INVALID` at the
proxy), so the reference page renders in a fallback face here. The port
self-hosts both families through `next/font`, which loads all six faces with
no external request. Visual comparison above was therefore done with fonts
held equal on both sides.

## W02 — Diagnostic + Competency Graph

```
Wave:            W02 — Diagnostic + Competency Graph
Status:          INTEGRATED
Certification:   BTG_W02_DIAGNOSTIC_READY (pending live Supabase for LIVE_CERTIFIED)
Schema:          +5 migrations, 20260918001100 → 20260918001500
Implementation:  E4 competency graph (domains, competencies, 5-level ladder,
                 acyclic prerequisites, gap read model); E3 diagnostic engine
                 (catalogue, question bank with isolated answer keys, attempts,
                 responses, adaptive walk, server-side grading, persisted
                 baseline); /baseline and /baseline/results; baseline journey
                 gate now live; dashboard baseline card
Tests:           130/130 vitest (57 domain, 73 database/RLS), 14/14 Playwright
Failures:        none
Defects repaired: 1 (seed authored every correct answer in the same option slot)
External blockers: Supabase project still unprovisioned, so the baseline
                 browser journey is written but unrun and the W02 UI has not
                 been rendered against a live session
Next execution:  W03 — Pathway Engine, Batch A+B
```

### Security decisions worth knowing

- `diagnostic_answer_keys` carries **no grant** to `authenticated`. A learner with a valid session cannot read it; only the security-definer scoring command can.
- `diagnostic_responses.is_correct` is withheld by **column-level grant**, so a learner can see what they answered but not how it was graded. RLS filters rows, not columns, which is why a column grant is the right tool here.
- Attempts, responses and `learner_competencies` have no direct INSERT/UPDATE for `authenticated`: the five commands are the only write path, so a learner cannot forge a competency level.

## Batched execution — E5 through E17 (W03 – W10 scope)

From here the work ran as dependency-ordered batches rather than one wave per
prompt. Each batch is one or more commits on the same branch.

```
Scope:           E5 pathway, E6 learning, E7 AI tutor, E8 projects,
                 E9 evidence/verification, E10 credentials, E11 mentorship,
                 E12 opportunities, E13 matching, E14 cohort aggregates,
                 E15 application pipeline, E17 outcomes/analytics
Status:          INTEGRATED
Certification:   BTG_AI_E2E_INTEGRATED (see Batch 7 for live schema certification)
Schema:          +23 migrations, 20260918001600 → 20260918003800
                 (38 migrations total, 20260918000100 → 20260918003800)
Implementation:  /pathway, /pathway/[stepId], /tutor, /projects,
                 /projects/[projectId], /review, /review/[reviewId],
                 /portfolio, /opportunities, /mentorship, /outcomes;
                 dashboard outcome funnel replacing the stale "what unlocks
                 next" panel
Tests:           285/285 vitest (73 domain, 212 database/RLS),
                 14/14 Playwright (7 skipped: need Supabase)
Failures:        none
Defects repaired: 17 across the batches (see below)
External blockers: Supabase project still unprovisioned. The browser journey
                 specs and the PostgREST request path remain unrun; nothing is
                 LIVE_CERTIFIED
```

### Batch 1 — E5 pathway, E6 learning

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 1 | Pathway regeneration violated `pathways_one_active` | The new plan was activated before the old one was superseded | Supersede first, then activate |
| 2 | A superseded plan could not keep `activated_at` | `pathways_active_consistency` was written as an equivalence | Loosened to an implication: active ⇒ activated, not the converse |
| 3 | A journey test asserted that unimplemented gates exist | Obsolete once every gate shipped | Rewritten as an invariant that still guards a future `implemented: false` gate |

### Batch 2 — E8 projects, E9 evidence, E10 credentials

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 4 | `submit_evidence` moved a project `assigned → submitted`, which the registry forbids | The command skipped `started` | Route through `started` |
| 5 | A reviewer's decision could not notify the learner | `enqueue_notification` refuses notifying another profile — right for a client, wrong for a governed command | Added `btg.notify`, internal, **not** granted to `authenticated` |
| 6 | A verified skill rendered as no skill at all | `portfolio_view` is `security_invoker` and joins the reviewer's profile, which a learner cannot read, so the join filtered every row out | Narrow policy `profiles_select_reviewer_of_own_evidence` + a leak-regression test |
| 7 | A reviewer was trapped on `/baseline` | Journey gates applied to every persona | `learnerOnly` gates, skipped when `primary_persona` is not `learner` |
| 8 | Three Batch 1 tests asserted a learning-only completion rule | Obsolete: Batch 2 replaced the rule intentionally | Updated to the new contract |

### Batch 3 — E11 mentorship, E12 opportunities, E13 matching

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 9 | `mentor_notes` hidden by a column grant would also have been hidden from the mentor who wrote it | Column grants apply to the role, not the row | Moved to `mentor_session_notes` behind a row policy |
| 10 | TypeScript allowed `opportunity: draft → archived`, the registry did not | Drift between the two, caught by the parity test | Transition added to the registry |

### Batch 4 — E7 AI tutor

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 11 | `pathwaySteps` test helper could not assert the competency a tutor session binds to | The helper did not select `competency_id`, which the view does expose | Helper widened rather than the assertion weakened |

### Batch 5 — E15 application pipeline, E17 outcomes

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 12 | The application state machine declared the employer-side transitions but no command drove them, so an application could only ever be submitted or withdrawn — an outcome funnel with no way to reach an outcome | Missing commands | `advance_application` (organization side, re-authorized against the opportunity's organization, rejection requires a readable reason) and `respond_to_offer` (the applicant's alone; an organization attempting `accepted` is refused `42501`) |
| 13 | A project reached `completed` inside `decide_review` with no event of its own | The only recorded fact was `verification.skill.verified` | `after update` trigger on `public.projects` emitting `project.project.completed`, so the event follows the transition wherever it is driven from |

### Batch 7 — live Supabase convergence and certification

```
Scope:           Connect a live Supabase project; apply and prove the full
                 forward chain; certify grants, RLS and seed content live
Status:          INTEGRATED (live schema certified; live browser journey not yet run)
Project:         epmtfqqemxumsjbthsmq (us-east-2, Postgres 17)
Schema:          38/38 migrations applied live, 20260918000100 -> 20260918003800,
                 recorded in the project's own migration ledger in order
Parity:          Proved by fingerprint across ten sections -- columns,
                 constraints, indexes, policies, function bodies, function
                 ACLs, grants, triggers, RLS flags, transition registry.
                 All ten identical to the local certified cluster
Seed:            4 domains, 8 competencies, 40 levels, 6 prerequisite edges,
                 24 questions, 24 answer keys, 28 transitions -- and the
                 deterministic answer rotation reproduced 6/6/6/6 live
Tests:           276/276 vitest (73 domain, 203 database/RLS)
Defects repaired: 1 critical, 1 hosted-platform divergence (below)
```

Notes on applying the chain to a hosted project:

- `tests/db/bootstrap.sql` is local-only and must **not** be applied: a hosted
  project provides `auth.users`, `auth.uid()` and the `anon`/`authenticated`/
  `service_role` roles natively. The chain references only `auth.uid()` and
  `auth.users`, so it applies unchanged without the shim.
- The `on_auth_user_created` trigger on `auth.users` installs cleanly.
- Local runs Postgres 16 and this project runs 17; no migration needed a change
  for the version difference.
- The local shim installs `pgcrypto` into `public`, where a hosted project puts
  it in `extensions`. That accounts for a 36-function difference in any naive
  function count, and is why the parity fingerprint excludes extension-owned
  functions.

### Batch 7 defects

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 15 | **CRITICAL.** Any authenticated session could call the internal `btg.*` helpers. `btg.complete_pathway_step` is SECURITY DEFINER with no actor check, so any learner could mark **any** learner's pathway step `completed`, bypassing the learning-and-verified-evidence rule the engine rests on. `btg.issue_eligible_credentials` and `btg.compute_opportunity_matches` were open the same way | Postgres grants `EXECUTE` on every new function to the pseudo-role `PUBLIC`. Only `btg.notify` ever revoked it, and migration 000100 grants `usage on schema btg to authenticated`, so the schema was reachable. 276 tests missed it because the suite only ever asserted **table** grants, never function `EXECUTE` | `EXECUTE` on the `btg` schema withdrawn wholesale, then re-granted only to the eight read-only authorization predicates RLS must evaluate as the calling role. `tests/db/grants.test.ts` asserts both directions — that the internal mutators are unreachable, and that the predicates stay callable, since withdrawing those would fail every policy closed |
| 16 | On a hosted project, `anon` and `authenticated` held all seven table privileges on everything in `public`, plus `EXECUTE` on every function, and `diagnostic_answer_keys` — deliberately granted to nobody — acquired a `SELECT` grant | Supabase ships default privileges for the `public` schema. The migrations were authored against a bare cluster where `authenticated` receives only what is explicitly granted, so the layered grant+RLS defence certified locally collapsed to RLS alone | Intended matrix re-asserted explicitly and default privileges revoked so future tables cannot re-acquire them. Nothing was exposed in the interim: RLS denied every path, because no permissive policy exists for `anon` and the write paths have no policy at all |

**The critical one was confirmed present on the local cluster too, not only
live.** It was a repository defect that live certification surfaced, which is
the point of doing it.

### Batch 8 — live security re-certification

```
Scope:           One explicit security pass over the live project, on the
                 premise that the 003700 ACL defect might not be the only one
Status:          Complete. It was not the only one
Schema:          38 migrations, 20260918000100 -> 20260918003800
Parity:          Ten-section fingerprint re-proved identical after the fix
Supabase linter: function_search_path_mutable cleared (10 -> 0)
Tests:           285/285 vitest (73 domain, 212 database/RLS)
```

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 17 | **HIGH.** `public.record_audit_event` was granted to `authenticated`, and the action string is a free parameter. Any learner could write arbitrary lifecycle actions into the audit ledger at any severity — including the actions `outcome_timeline_view` maps — so a learner could show themselves a history that never happened. Proven: a learner with zero credentials produced `joined(1), credential_issued(12), opportunity_accepted(18)` with 0 rows in `public.credentials`. `public.enqueue_notification` was open the same way | Both were granted on the assumption the application would write events itself. It never did: the two TypeScript wrappers had one caller between them | Neither is callable from a session. The governed commands are SECURITY DEFINER and execute as the owner, so they never needed the grant. The one real client-side audit write — marking a notification read — became its own governed command, `public.mark_notification_read`, which marks the row and records the entry in one transaction and can only touch the caller's own notification |

`learner_outcome_view` was never affected: it counts canonical tables, not the
ledger. The timeline was, and so was the integrity of the ledger itself.

Five existing tests drove `record_audit_event` / `enqueue_notification`
directly as `authenticated`. Their expectations were obsolete by intent, so
each was re-routed to assert the same property through the correct path — actor
stamping through a governed command, notification idempotency through
`btg.notify`, ledger immutability and the action-format constraint as the
owner, which is the context a definer command runs in. None was weakened.

### Also certified in this pass

- Every one of the 7 views carries `security_invoker = true`. A view left on
  definer semantics would read past the caller's RLS.
- Neither `anon` nor `authenticated` holds `CREATE` on `public` or `btg`, so a
  mutable `search_path` was never plantable. Pinned on all ten flagged
  functions regardless.
- `search_path` is now pinned on every non-extension function in both schemas,
  asserted by test rather than by the linter alone.
- The 30 remaining `SECURITY DEFINER` functions callable by `authenticated` are
  exactly the governed command API. That is the intended write surface; each
  performs its own actor and authorization checks.
- Supabase's `pg_graphql` lint reports 57 objects discoverable to signed-in
  users. Accepted: RLS governs rows, and table-name discoverability is not a
  data leak. Disabling the GraphQL endpoint in the project's API settings would
  reduce the surface further; that is account configuration, not schema.

### E17 design decisions worth knowing

- No new store and no vendor: every figure is derived from the canonical table that owns the state, or from the audit ledger that recorded the transition.
- `cohort_outcomes` is a definer function, **not** a `security_invoker` view over `learner_outcome_view`. The view form would have returned silent zeros to an organization admin (defect 6's class), and fixing that with broad cross-learner read policies would be a privacy regression. It authorizes against the cohort's organization, returns aggregates only, and refuses a cohort of fewer than five learners because an aggregate over a handful identifies the individual.
- A database test asserts that the stage names published by `outcome_timeline_view` match `OUTCOME_STAGES` in TypeScript exactly, so the ledger and the UI cannot drift into a blank label.

### Cross-engine convergence

`tests/db/journey.test.ts` walks one learner through every engine using the
real commands only — no direct writes, no fixtures inserted behind the domain —
from sign-up to an accepted offer, and asserts each engine's output from the
record the previous engine produced: onboarding completed → baseline measured →
pathway traceable to that attempt → module completed → three projects proven →
`ai-foundations-certificate` issued with its `issuance_basis` → the verified
level outranking the diagnostic estimate → a non-zero enumerated match →
application advanced to offered → accepted → the outcome funnel and ledger
timeline agreeing with all of it.

### Batch 6 — pilot hardening

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 14 | Any cohort member reading `public.cohorts` got `infinite recursion detected in policy for relation "cohort_members"` | `cohort_members_select` answered its own question with `exists (select 1 from public.cohort_members mine ...)` — a policy on the table reading the table. `cohorts_select` inherited the fault through its reference to `cohort_members` | `btg.is_cohort_member`, a SECURITY DEFINER helper answering the membership question outside RLS, exactly as `btg.is_org_admin` already does for memberships. Both policies rewritten to use it |

Found by writing the boundary test the new organization cohort panel depends on
— that a member can see their cohort but never its aggregate. A learner in a
cohort could not read the cohort they belonged to at all.

Also in this batch: lint taken to 0 errors / 0 warnings (three dead imports
removed; `argsIgnorePattern: "^_"` declared for the previous-state argument that
`useActionState` requires positionally and which therefore cannot be deleted —
unused *variables* and caught errors remain flagged, verified with a probe
file), and the smallest governed organization read surface over `cohort_outcomes`.

Pilot scope decisions and go/no-go gates: `BTG_AI_PILOT.md`.

Engine-by-engine certification: `BTG_AI_ENGINES.md`.
Route classification: `BTG_AI_ROUTES.md`.

## W14-B — Execution tier (Workflow OS convergence, batch B)

```
Wave:            W14 — Workflow OS Convergence, batch B (execution tier)
Status:          INTEGRATED
Certification:   BTG_WORKFLOW_OS_BLOCKED (on W14-A, externally — see below)
Schema:          +1 forward migration (20260918003900_execution_tier), 39 total
Implementation:  btg.work_queue, claim/complete/fail/fail-permanently with
                 lease + exponential backoff + dead-letter, lease reaping,
                 btg.dispatch_notification, btg.drain_notifications,
                 btg.queue_health; notification state machine registered
Tests:           301/301 vitest across 20 files (+16 execution, +19 grant
                 surface since the last entry)
Failures:        none
Defects repaired: 1 test-harness defect (see below)
External blockers: no service-role key reachable from this session, so no drain
                 invoker is wired; W14-A (live substrate) stays BLOCKED_EXTERNAL
Next execution:  W14-A when the project host is reachable; then W14-C
```

### What this closes

E16 enqueued notifications and nothing ever dequeued them. `notifications`
carried a `status` enum whose `pending → sent` edge had **no** row in
`btg.state_transitions` — the one status enum in the system with no registered
machine — which is the schema-level tell that no execution tier existed. Every
notification written since W01 was still `pending`.

W14-B adds the smallest durable execution tier that makes `pending → sent` a
real transition, and nothing more. It is a work queue, a worker, and a drain
function; it is not an orchestrator. Full design, the three-truths model, and
the specified-but-unbuilt W14-C/W14-D tables: `BTG_AI_WORKFLOW_OS.md`.

### Deliberate deviation from the stated technology choice

The W14 contract preferred `pgmq` + `pg_cron` + `pg_net`. All three — and
`http` — are absent from `pg_available_extensions` on a bare Postgres cluster,
which is the certification substrate, so a pgmq-based queue would have been
uncertifiable locally and unverifiable anywhere the repo is cloned. The queue
is instead `FOR UPDATE SKIP LOCKED` over one table: portable, certifiable on
the cluster the test suite already runs, and behaviourally equivalent for a
single-consumer workload. `pgmq` remains a swap behind the same four function
signatures if the hosted project later warrants it.

### Design decisions worth knowing

- **`attempts` increments at claim time, not at failure.** A worker that dies
  mid-work never gets a free retry; the lease reaper returns the item to
  `queued` with the attempt already spent, so a poison payload cannot loop.
- **Backoff `least(3600, 5 * power(2, attempts - 1))` seconds**, then `dead` at
  `max_attempts`. `fail_work_permanently` skips straight to `dead` for a
  non-retryable condition (no provider for the channel), so a mis-addressed
  email does not burn five attempts.
- **Idempotent enqueue** via a partial unique index on `(queue,
  idempotency_key) where idempotency_key is not null`, so a command that runs
  twice in a retry enqueues once.
- **`in_app` dispatches to `sent`; `email` and `push` dead-letter with
  `no_provider`.** The tier is honest about having no transport rather than
  reporting a delivery that did not happen.
- **Every runtime function is `service_role` only**, each with an explicit
  `revoke all ... from public, anon, authenticated`. A learner cannot enqueue
  work, claim work, or mark work done; asserted by name in
  `tests/db/execution.test.ts`, not inferred from a default.

### Defect found and repaired

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 18 | The database suite was order-dependent: a test using the `anon` helper could poison a pooled connection and fail an unrelated later test | `asAnon` in `tests/db/helpers.ts` had no `catch` around its body, so a deliberately-failing assertion left the transaction open on a connection returned to the pool. It also set role `authenticated` rather than `anon`, meaning every "anon is denied" assertion had been proving the wrong thing | `catch { rollback }` added; role corrected to `anon`. Both faults predate W14-B and were surfaced by it |

The state-machine parity test also correctly caught the `notification` machine
being added to the database without its TypeScript mirror. Fixed by adding
`notificationMachine` to `DB_STATE_MACHINES` (17 machines); the test was not
weakened.

### Live proof of the executor primitives

Applied to the live project and exercised there with a throwaway `live_probe`
queue: idempotent enqueue, exclusive claim under concurrency, backoff, dead-
letter at the attempt ceiling, and lease reaping. Final `btg.queue_health` read
exactly one `queued` and one `dead` row for the probe queue; probe rows then
deleted (`remaining_probe_rows: 0`). This certifies the queue primitives over
the SQL boundary — it does **not** certify the substrate, which needs PostgREST
and Auth and remains W14-A.

## W14-C — Workflow core (Workflow OS convergence, batch C)

```
Wave:            W14 — Workflow OS Convergence, batch C (workflow core)
Status:          INTEGRATED
Certification:   BTG_WORKFLOW_OS_BLOCKED (on W14-A, externally)
Schema:          +1 forward migration (20260918004000_workflow_core), 40 total
Implementation:  workflow_definitions / _definition_versions / _definition_steps /
                 workflow_instances / workflow_work_items (public, RLS);
                 btg.workflow_taxonomy + btg.workflow_checks (allowlists);
                 start_workflow, advance_instance, complete_work_item,
                 fail_work_item, cancel_workflow, bind_work_item_subject,
                 publish_definition_version, assert_step_satisfied,
                 record_workflow_event; 3 lifecycle machines registered
Tests:           342/342 vitest across 21 files (+41 workflow)
Failures:        none
Defects repaired: 1 (in my own fingerprint method — see below)
External blockers: unchanged; W14-A stays BLOCKED_EXTERNAL
Next execution:  W14-D — private orchestration stream + generic dispatcher
```

### The one property that matters

`btg.complete_work_item` refuses to mark a step completed unless the **engines
already show** the state that step requires. The step names a check, the check
is foreign-keyed to an allowlist, and the allowlist's implementation is a
hardcoded `CASE` that reads the engine's own table — no dynamic SQL, so a step
can never name a function to execute.

That makes the workflow a projection of the domain rather than a second
authority over it, and it is enforced rather than documented: completing
`attempt_scored` while the attempt is still `in_progress` is refused, binding
another learner's attempt is refused (the check matches `profile_id` too), and
a check pointed at the wrong kind of entity is refused before it runs.

### Design decisions worth knowing

- **A published definition version is immutable.** One trigger permits exactly
  one change — supersession — and refuses everything else including deletion;
  the step catalog freezes with the version; versions are monotonic (`max + 1`,
  a chosen number is rejected); at most one is published per definition. An
  instance pins its version and a trigger refuses to change the pin, so a
  definition change can never retroactively alter an in-flight run.
- **The step catalog is a table, not a jsonb spec.** A spec would have to be
  interpreted at run time, and interpreting a payload is how a dispatcher ends
  up executing what a payload named. `handler` is an enum, `completion_check`
  is foreign-keyed, and `start_workflow` refuses any handler no dispatcher
  resolves yet — so a version cannot strand an instance.
- **16 of 17 definitions are reserved, not built.** Only `baseline_diagnostic`
  is enabled with a published v1. A definition with no published version cannot
  be instantiated, which is the honest state for a batch that has not landed.
  `BTG_LEARNER_TO_OPPORTUNITY` is reserved the same way.
- **Work items reference domain entities, never copy them.**
  `(subject_type, subject_id)` plus an 8 KiB bound on `input`, both enforced; a
  test asserts the payload stays empty across the diagnostic walk, and another
  asserts no workflow table carries a domain enum.
- **The runtime got its own evidence writer.** `record_audit_event` requires an
  authenticated actor and 003800 closed it to sessions; a worker has no
  session. `btg.record_workflow_event` writes the same shape with a null actor
  and `metadata.actor = 'workflow_runtime'`, so a runtime action is never
  attributed to a learner who did not take it. Service-role only; a session
  calling it gets 42501.
- **No second queue.** W14-C adds no queue; the dispatcher in W14-D will claim
  from `btg.work_queue`.

### Defect found and repaired

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 19 | The live/local schema fingerprint could report a false mismatch — the transition registry hashed differently on the two clusters while containing byte-identical rows | The fingerprint aggregated with `string_agg(... order by x)`, which is **collation-dependent**. The local cluster orders text under `C`, the hosted project under a UTF-8 locale, so identical row sets concatenate in different orders and hash differently. Nine of ten sections happened to be collation-stable, which is why earlier passes agreed by luck | Every aggregate now sorts `collate "C"`, and the query became `scripts/schema-fingerprint.sql` instead of being retyped each time. Isolated by hashing per machine on both sides first, which showed all 20 machines identical — the schema was never wrong, the check was |

Worth stating plainly: this defect was in the **verification**, not the system.
A parity check that can disagree with itself is worse than no parity check,
because it spends the next hour hunting a schema difference that does not
exist.

### Live state

40/40 migrations applied to `epmtfqqemxumsjbthsmq` and recorded in its ledger.
All ten fingerprint sections identical to the local certified cluster after the
collation fix. Live catalog verified directly: 17 definitions, 1 enabled, 1
published version, 3 steps reading
`attempt_started/diagnostic_attempt_started → attempt_scored/diagnostic_attempt_scored
→ baseline_recorded/learner_baseline_recorded`, 16 taxonomy labels, 3 checks,
and **0** of the 9 runtime functions reachable by `anon` or `authenticated`.

The positive walk is certified locally only. Running it live would require an
`auth.users` row, and the W14 contract forbids fabricating one to get past the
W14-A gate — so it was not done, rather than done and reported as live.

## W14-D/E/F/G — Workflow OS end-to-end convergence

```
Wave:            W14 — Workflow OS Convergence, batches D, E, F, G
                 + application convergence
Status:          INTEGRATED
Certification:   BTG_WORKFLOW_OS_READY_WITH_BLOCKERS
                 (implementation complete; live substrate certification external)
Schema:          +11 forward migrations (20260918004100 - 20260918004800), 51 total
Implementation:  D  btg.orchestration_events (trusted-only, append-only,
                    idempotent) + one generic dispatcher, no dynamic SQL
                 E  human work on the existing workflow_work_items: atomic
                    claim, SLA, escalation, reassignment, no self-review
                 F  four operator projections, no new authority
                 G  BTG_LEARNER_TO_OPPORTUNITY, 14 steps, published
                 App: ensure_my_workflow / signal_my_workflows /
                    advance_my_workflows / my_workflow_state / my_work_queue,
                    wired into the surfaces that already existed
Tests:           430/430 vitest across 26 files (+88 since W14-C)
                 14/21 Playwright pass, 7 skip on the live-Auth gate
Failures:        none
Defects repaired: 11 (defects 20-30; 5 of them pre-existing)
External blockers: W14-A unchanged - BLOCKED_EXTERNAL
Next execution:  W14-A live certification, when the substrate is reachable
```

Architecture, rationale and the properties each batch guarantees are in
`BTG_AI_WORKFLOW_OS.md`. This section records what was certified and what broke.

### Defects found and repaired

| # | Defect | Root cause | Repair |
|---|---|---|---|
| 20 | `generate_pathway_for` aborted when a worker ran it, so the pathway step of a workflow could never complete | The worker-drivable guard checked `public.record_audit_event` and missed `public.enqueue_notification` — both are session-only writers, only one was known to the guard | `btg.notify` as the runtime counterpart, and the guard no longer carries a hand-written list: it discovers session-only writers from `pg_proc`, plus a behavioural test that runs the path with no session at all |
| 21 | **Pre-existing.** A learner could hold an "active" pathway with no ledger entry and no steps | `generate_pathway`'s empty-plan branch activated the pathway without recording it; `learner_has_active_pathway` accepted a pathway with zero steps | Both closed: the branch records, and the check requires at least one step |
| 22 | A work item past its deadline was retried instead of failed | Deadline breach routed through `btg.fail_work_item`, which schedules a retry | `btg.abandon_work_item` for terminal failure |
| 23 | A global dispatcher tally made tests order-dependent on a shared database | The dispatcher claimed across all instances, so a concurrent test changed another's counts | `p_instance_id` on `claim_workflow_items` and `dispatch_workflow_work`; tests drain one instance |
| 24 | A reviewer could not see work assigned to their persona | Both the work-item and the definition-catalog policies omitted the persona-owned case | `btg.may_act_on_item` / `may_see_version` / `may_see_definition` / `may_act_on_instance`, and the policies rewritten to use them |
| 25 | A signal did not release the human step it satisfied | `signal_workflow_subject` bound only enqueueable steps, skipping `pending` and human ones | It now binds pending and human steps without enqueueing them — a human step is a durable wait, not queued work |
| 26 | Reassigning a work item raised a constraint violation | The new owner was set without clearing `owner_persona`, violating `work_item_persona_owner` | `reassign_work_item` clears the persona |
| 27 | A policy denied everything, silently | It read `w.workflow_instance_id = id`, which binds `id` to the subquery's own table — always false | Qualified the outer reference. Worth noting the failure mode: a policy that is always false looks exactly like correct denial |
| 28 | A poison item was retried forever instead of dead-lettered | Same root cause as 22, on the dead-letter path | Same repair |
| 29 | **Pre-existing.** A learner's timeline omitted events a reviewer, mentor or employer acted | The ledger's `actor_profile_id` answers "who acted"; a learner timeline needs "whose outcome is this" | `btg.stamp_outcome_subject` derives `metadata.subject` from the object at insert, and the timeline view prefers it over the actor |
| 30 | **Pre-existing.** Every function a future migration created in `public` would have been EXECUTE-able by `authenticated` with no GRANT written anywhere | 003700's default-privilege sweep revoked function defaults from `anon` and not from `authenticated`, so the hosted project still carried `authenticated=X` as a default for grantor `postgres` | 004800 revokes the table, sequence and function defaults for both session roles and PUBLIC, in both schemas; fingerprint section 11 and two guard tests now read the privileges a not-yet-created object would inherit |

Defect 30 is the second half of a lesson 003700 taught once already, and the
standing rule it produced — *do not assume the previous default-privilege issue
was the only one* — is what found it. A default privilege grants nothing until
something is created, so no test that reads existing objects can see it. The
ten-section fingerprint could not see it either, which is why there are now
eleven.

Defect 27 deserves a second mention for the same reason: an always-false policy
and a correct policy are indistinguishable from the outside. Both were found by
asserting the *positive* case — that the right person can see the row — not
only that the wrong one cannot.

A methodology note, since it cost an hour twice now. Sections 04, 07 and 08
appeared to diverge in this pass, and did not: the live query had been *retyped*
from memory rather than run from `scripts/schema-fingerprint.sql`, and the
retyped version formatted its rows differently (it included policy roles, and
read function EXECUTE through `aclexplode` instead of
`has_function_privilege`). Two schemas hashed differently because two different
questions were asked. This is defect 19's lesson in its second form: the script
exists so the question is identical on both sides — run it, do not retype it.
Confirmed by bucketing both sides with one shared query, which showed all 114
buckets equal before the script itself confirmed 11/11.

### Live state

51/51 migrations applied to `epmtfqqemxumsjbthsmq` and recorded in its ledger,
with the ledger's set of names provably equal to the repository's migration
files. **All eleven fingerprint sections identical** to a from-scratch local
rebuild, including grants and the default privileges of section 11.

Two live-only conditions, reported rather than folded into a matching hash:

- The ledger records `20260918004300_human_work` as applied before `004100` and
  `004200` (it had to be separate, because Postgres refuses to use a new enum
  value in the transaction that added it). The end state is nonetheless proven
  equivalent to an in-order build: the local cluster was rebuilt from scratch in
  file order and all eleven sections match.
- Six default-privilege entries whose grantor is `supabase_admin` grant `anon`
  and `authenticated` broadly in `public`. **`postgres` is not a member of that
  role**, so no migration can revoke them — and nothing inherits them: every
  relation in `public` and `btg` is owned by `postgres`. Verified, not assumed.

The positive human-work and coordinator walks are certified locally only. Doing
them live would require `auth.users` rows, and the W14 contract forbids
fabricating one to get past the W14-A gate — so they were not done, rather than
done and reported as live.

## How to reproduce the certification

```bash
npm install
npm run db:local:up     # Postgres 16 cluster + all migrations
npm run test:all        # 430 tests: domain + database/RLS
npm run build
BTG_E2E_CHROMIUM=/opt/pw-browsers/chromium npx playwright test
psql "$BTG_TEST_DATABASE_URL" -At -F'|' -f scripts/schema-fingerprint.sql
```

The `db` project applies `supabase/migrations` to a bare cluster plus the
`auth` shim in `tests/db/bootstrap.sql`, and exercises RLS as the
`authenticated` role with `auth.uid()` resolved from the request claim — the
same way PostgREST runs a session.
