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

## How to reproduce the certification

```bash
npm install
npm run db:local:up     # Postgres 16 cluster + all migrations
npm run test:all        # 285 tests: domain + database/RLS
npm run build
BTG_E2E_CHROMIUM=/opt/pw-browsers/chromium npx playwright test
```

The `db` project applies `supabase/migrations` to a bare cluster plus the
`auth` shim in `tests/db/bootstrap.sql`, and exercises RLS as the
`authenticated` role with `auth.uid()` resolved from the request claim — the
same way PostgREST runs a session.
