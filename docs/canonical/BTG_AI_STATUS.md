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

## Waves W02 – W10

All `NOT_STARTED`.

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
