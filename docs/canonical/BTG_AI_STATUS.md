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

## Waves W03 – W10

All `NOT_STARTED`. Engine-by-engine certification: `BTG_AI_ENGINES.md`.
Route classification: `BTG_AI_ROUTES.md`.

## How to reproduce the certification

```bash
npm install
npm run db:local:up     # Postgres 16 cluster + all migrations
npm run test:all        # 75 tests: domain + database/RLS
npm run build
BTG_E2E_CHROMIUM=/opt/pw-browsers/chromium npx playwright test
```

The `db` project applies `supabase/migrations` to a bare cluster plus the
`auth` shim in `tests/db/bootstrap.sql`, and exercises RLS as the
`authenticated` role with `auth.uid()` resolved from the request claim — the
same way PostgREST runs a session.
