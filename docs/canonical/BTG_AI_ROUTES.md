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
| `/dashboard` | IMPLEMENTED | Every card sourced from a canonical engine, including the E17 outcome funnel; no invented metrics |
| `/organizations` | IMPLEMENTED | Capability-gated; atomic provisioning with a founder membership; cohort outcome aggregates behind `outcomes.read_org` |
| `/baseline` | IMPLEMENTED | Adaptive probe, one question per view, resumes where it stopped |
| `/baseline/results` | IMPLEMENTED | Gap diagnosis from the `learner_competency_gaps` read model |
| `/pathway` | IMPLEMENTED | Generated plan, per-step status, blocking steps and rationale |
| `/pathway/[stepId]` | IMPLEMENTED | Step detail with its modules and activities |
| `/tutor` | IMPLEMENTED | Governed tutor; every turn recorded with its policy version and outcome |
| `/projects` | IMPLEMENTED | Assignable briefs and the learner's own projects |
| `/projects/[projectId]` | IMPLEMENTED | Brief, rubric, evidence submission |
| `/review` | IMPLEMENTED | Reviewer queue, capability-gated |
| `/review/[reviewId]` | IMPLEMENTED | Rubric-bound decision with required rationale |
| `/portfolio` | IMPLEMENTED | Verified skills and issued credentials with their chain |
| `/opportunities` | IMPLEMENTED | Explainable matches, disclosure-controlled apply, offer response |
| `/mentorship` | IMPLEMENTED | Explained recommendations, request and response |
| `/outcomes` | IMPLEMENTED | E17 funnel and ledger timeline; every figure traced to a record |
| `/console/*`, `/analytics/*` | POST_PILOT | Operator console and cross-organization analytics. The governed per-organization read surface now lives on `/organizations` |
| `/portal/*` (university, employer, sponsor) | MISSING | Partner portals. Organization membership and the application pipeline are implemented; `/organizations` is the surface |
| `/community/*` | POST_PILOT | No discussion or peer surface. Cohort aggregation is the pilot scope |
| `/credentials/[id]` (public verification) | MISSING | Credentials are issued and visible to their holder; no public verification page |

No route structure was invented for an unbuilt surface. Every journey gate in
`src/domain/identity/journey.ts` now points at an implemented route; the
`implemented` flag and the invariant test that guards it remain, so a future
gate can be registered before its route exists without routing anyone to a 404.
`learnerOnly` gates are skipped for a non-learner persona, so a reviewer is
never trapped on `/baseline`.

## Navigation

`src/components/app/navigation.ts` lists only implemented routes, each behind
the capability that reveals it. Seeing a nav item never implies access: the
server action and RLS re-check the same capability.
