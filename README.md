# BTG AI — Bridging the Gap

Learn → Build → Prove → Get matched.

BTG AI measures where a learner actually is, builds a pathway from the gap,
gives them real projects, verifies the evidence they produce, and connects that
verified skill to mentors and opportunities.

## Status

W01–W14 are present: identity, diagnostics, pathways, seed-scale learning,
projects, reviewed evidence, credentials, opportunities and governed workflows.
See [`docs/canonical/BTG_AI_STATUS.md`](docs/canonical/BTG_AI_STATUS.md).

The canonical 112-lesson Batch 0 design, deterministic draft seed and validation
commands are in [`curriculum/README.md`](curriculum/README.md). These contracts
are not a claim that the new curriculum is published or runtime-certified.

Architecture decisions live in
[`docs/canonical/BTG_AI_CANONICAL.md`](docs/canonical/BTG_AI_CANONICAL.md).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project values
npm run dev
```

Without Supabase credentials the public marketing surface still renders; the
authenticated surface needs a project.

### Applying the schema

Migrations are plain SQL in `supabase/migrations`, applied in filename order:

```bash
supabase link --project-ref <ref>
supabase db push
```

## Testing

| Command | What it covers |
|---|---|
| `npm run test` | Domain unit tests (state machines, authorization, schemas, error mapping) |
| `npm run db:local:up` | Starts a local Postgres 16 cluster and applies every migration |
| `npm run test:db` | Schema, constraints, immutability, RLS and persona/tenant isolation against that cluster |
| `npm run test:all` | Both projects |
| `npx playwright test` | Browser E2E. The golden journey needs a live Supabase project and skips without one |

The database tests execute as the `authenticated` role with `auth.uid()`
resolved from the request claim, so RLS is exercised the way PostgREST runs it
rather than simulated.

## Layout

```
src/domain/      engine boundaries: types, state machines, authorization, schemas
src/server/      services (data access) and server actions (validated commands)
src/lib/         Supabase clients, environment contract, database row contracts
src/components/  ui primitives, app shell, feature components
src/app/         routes: public surface, auth, and the authenticated shell
supabase/        SQL migrations
tests/           domain, db (schema + RLS) and e2e suites
```
