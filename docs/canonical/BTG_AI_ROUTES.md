# BTG AI — Route Audit

Classification: `IMPLEMENTED` (UI → action → service → DB → authz → audit),
`PARTIAL`, `PLACEHOLDER` (renders, no product behind it), `MISSING`.

| Route | Status | Notes |
|---|---|---|
| `/` | IMPLEMENTED | Native port of `btg-ai-landing/index.html`; static; every CTA resolves |
| `/join` | IMPLEMENTED | Zod-validated signup; accepts `?intent=<persona>` from partner CTAs |
| `/sign-in` | IMPLEMENTED | Resolves destination from persisted state, not a fixed `/dashboard` |
| `/auth/callback` | IMPLEMENTED | Exchanges the email-confirmation code for a session |
| `/onboarding` | IMPLEMENTED | 4 steps, atomic DB command, forward-only state machine |
| `/dashboard` | IMPLEMENTED | Every card sourced from a W01 engine; no invented metrics |
| `/organizations` | IMPLEMENTED | Capability-gated; atomic provisioning with a founder membership |
| `/baseline`, `/baseline/results` | MISSING | W02 — Diagnostic Engine. Gate registered, `implemented: false` |
| `/pathway` | MISSING | W03 — Pathway Engine. Gate registered, `implemented: false` |
| `/learn/*`, `/tutor` | MISSING | W04 |
| `/projects/*`, `/challenges/*` | MISSING | W05 |
| `/evidence/*`, `/review/*`, `/credentials/*` | MISSING | W06 |
| `/mentorship/*`, `/community/*` | MISSING | W07 |
| `/opportunities/*`, `/applications/*` | MISSING | W08 |
| `/portal/*` (university, employer, sponsor) | MISSING | W09 |
| `/console/*`, `/analytics/*` | MISSING | W10 |

No route structure was invented for an unbuilt wave. The unbuilt stages exist
only as registered gates in `src/domain/identity/journey.ts`, which the
resolver skips while `implemented` is false — so nothing routes to a 404 and
shipping a wave flips one flag.

## Navigation

`src/components/app/navigation.ts` lists only implemented routes, each behind
the capability that reveals it. Seeing a nav item never implies access: the
server action and RLS re-check the same capability.
