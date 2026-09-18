# BTG AI — Canonical Reference

The repository is authoritative. This file records the decisions that outlive a
conversation; it is updated incrementally, never rewritten wholesale.

## Product contract

Learn → Build → Prove → Connect to opportunity.

```
Discover → Join → Onboard → Diagnose → Identify gaps → Generate pathway →
Learn → Practice → Build → Submit → Verify → Credential → Showcase →
Mentor → Match → Apply → Progress → Reassess
```

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript strict |
| Styling | Tailwind v4 with tokens in `src/app/globals.css`, shadcn-style primitives in `src/components/ui` |
| Data | Supabase (Postgres 17), RLS everywhere, SQL migrations in `supabase/migrations` |
| Validation | Zod at every server-action boundary |
| Tests | Vitest (`domain`, `db` projects), Playwright for browser E2E |

Next 16 renamed the middleware convention: request-level session handling lives
in `src/proxy.ts`, not `src/middleware.ts`.

## Engine boundaries (E1–E16)

Engines are directories, not folders of convenience. W01 implements E1, the
minimum of E2, and the foundations of E16.

| Engine | Status after W01 | Home |
|---|---|---|
| E1 Identity & Access | Implemented | `src/domain/identity`, `supabase/migrations/*identity*`, `*authorization_rls*` |
| E2 Learner Profile | Minimum surface (goals captured at onboarding) | `learner_profiles`, `src/domain/identity/onboarding.ts` |
| E3–E15 | Not started | — |
| E16 Governance | Audit ledger + notification foundation | `audit_events`, `src/server/services/audit-service.ts` |

## Authorization model

Three independent layers, in this order:

1. **Capability check in the domain** — `can()` / `assertCan()` in
   `src/domain/identity/actor.ts`. Org-scoped capabilities require a membership
   *in that organization*; a persona held elsewhere never leaks across tenants.
2. **Server action** — validates with Zod, resolves the actor server-side, then
   asserts the capability before touching a service.
3. **RLS** — the database re-checks everything through `btg.*` helper functions.
   Losing layers 1 and 2 would still not grant access.

Navigation is generated from capabilities (`src/components/app/navigation.ts`)
and only lists routes that exist, so no control is decorative.

Personas: `learner`, `mentor`, `reviewer`, `institution`, `employer`, `sponsor`,
`operator`. Platform personas live in `persona_grants`; organization personas
live in `memberships`.

## State machines

`btg.state_transitions` is the single registry, enforced by the generic
`btg.enforce_transition` trigger. `src/domain/identity/lifecycle.ts` mirrors it,
and `tests/db/schema.test.ts` fails if the two ever drift.

| Machine | States |
|---|---|
| `membership` | invited → active ⇄ suspended → revoked (terminal) |
| `persona_grant` | active ⇄ suspended → revoked (terminal) |
| `organization` | pending → active ⇄ suspended → archived (terminal) |
| `onboarding` | not_started → profile → persona → goals → consent → completed |

Onboarding is linear and forward-only: a client cannot post the final step to
skip consent.

## Authoritative domain commands

Multi-table writes are `SECURITY DEFINER` functions so they commit atomically
and stamp the actor from the session rather than trusting the caller.

| Function | Guarantees |
|---|---|
| `public.create_organization` | Organization + founding governing membership + audit event, or nothing |
| `public.complete_onboarding_step` | Step transition + profile/goal/consent writes + audit + completion notification, or nothing |
| `public.record_audit_event` | Only write path into the append-only ledger; actor taken from `auth.uid()` |
| `public.enqueue_notification` | Idempotent on `(profile_id, channel, dedupe_key)`; refuses to notify another profile |

## Audit

`audit_events` is append-only (update/delete rejected by trigger) and ordered by
`clock_timestamp()` so several events raised inside one transaction remain
orderable. `authenticated` holds `SELECT` only — never a direct write.

## Conventions

- Action format `<domain>.<object>.<verb>`, enforced by a check constraint and
  mirrored in `src/domain/shared/audit.ts`.
- Errors: services throw `DomainError`; `fromPostgresError` maps Postgres codes
  onto the taxonomy; server actions translate once, in `toActionState`.
- New migrations are forward-only once applied to any real project.
- No metric on a dashboard without a canonical engine behind it. Waves that are
  not built are described, never faked.
