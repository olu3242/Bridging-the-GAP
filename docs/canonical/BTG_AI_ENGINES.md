# BTG AI — Engine Certification

Certification: `READY` (traced UI → route → action → service → DB → authz →
transition → audit → visible outcome), `READY_WITH_GAPS`, `BLOCKED`, `MISSING`.

Engine IDs follow the repository's existing canonical set (E1–E16 in
`BTG_AI_CANONICAL.md`); the request's E01–E15 numbering maps onto it below.

| Engine | Status | UI | Backend | DB | Authz | Evidence/Audit | E2E | Gap |
|---|---|---|---|---|---|---|---|---|
| E1 Identity & Access | READY | yes | yes | yes | yes | yes | partial | Browser journey unrun without Supabase |
| E2 Learner Profile | READY_WITH_GAPS | yes | yes | yes | yes | yes | partial | Goals only; interests, availability, career prefs are W02 |
| E3 Diagnostic (baseline) | MISSING | — | — | — | — | — | — | Whole engine — W02 |
| E4 Competency Graph | MISSING | — | — | — | — | — | — | Whole engine — W02 |
| E5 Pathway | MISSING | — | — | — | — | — | — | Whole engine — W03 |
| E6 Learning | MISSING | — | — | — | — | — | — | Whole engine — W04 |
| E7 AI Tutor | MISSING | — | — | — | — | — | — | Whole engine — W04. Governance rules recorded, unenforced because no tutor exists |
| E8 Project | MISSING | — | — | — | — | — | — | Whole engine — W05 |
| E9 Evidence & Verification | MISSING | — | — | — | — | — | — | Whole engine — W06 |
| E10 Credential | MISSING | — | — | — | — | — | — | Whole engine — W06 |
| E11 Mentorship | MISSING | — | — | — | — | — | — | Whole engine — W07 |
| E12 Opportunity | MISSING | — | — | — | — | — | — | Whole engine — W08 |
| E13 Recommendation & Matching | MISSING | — | — | — | — | — | — | Whole engine — W08 |
| E14 Community | MISSING | — | — | — | — | — | — | Whole engine — W07 |
| E15 Progress & Outcome | MISSING | — | — | — | — | — | — | Whole engine — W09/W10 |
| E16 Governance & Intelligence | READY_WITH_GAPS | yes | yes | yes | yes | yes | yes | Audit + lifecycle events done; anonymous pre-auth analytics, rate limiting, error reporting are W10 |

## Engine contracts — the implemented engines

### E1 — Identity & Access

- **Primary persona** — every persona; learner by default.
- **Trigger** — signup, sign-in, organization provisioning, membership change.
- **Required inputs** — email + password + display name; optional `?intent`.
- **State** — `profiles.onboarding_state`, `memberships.status`, `persona_grants.status`, `organizations.status`.
- **Allowed transitions** — the four machines in `btg.state_transitions`; a database test asserts parity with `src/domain/identity/lifecycle.ts`.
- **Business rules** — onboarding is linear and forward-only; a landing intent pre-selects a persona but grants nothing; org personas require a membership; `platform` organizations are operator-only.
- **Permissions** — capability check in `actor.ts`, re-checked by RLS via `btg.*` helpers.
- **Tables** — `profiles`, `organizations`, `memberships`, `persona_grants`, `consents`.
- **Commands** — `create_organization`, `complete_onboarding_step`, `signUpAction`, `signInAction`, `createOrganizationAction`.
- **Evidence** — `identity.session.signed_up`, `identity.onboarding.started|step_completed|completed`, `identity.organization.created`, consent rows carrying `policy_version`.
- **Completion** — `onboarding_state = 'completed'` with `onboarding_completed_at` set.
- **Failure states** — duplicate email, duplicate org handle, out-of-order step, missing required consent, unauthenticated command, cross-tenant write.
- **Recovery** — every failure returns a typed `ActionState` with the field to fix; an interrupted onboarding resumes at the persisted step.
- **Observability** — audit ledger with correlation ids; structured console errors for unhandled action failures.
- **Tests** — 8 authorization, 10 state machine, 8 onboarding schema, 15 RLS, 16 command, 6 journey.

### E2 — Learner Profile (partial)

- **Trigger** — onboarding goals step. **Table** — `learner_profiles`.
- **Completion** — a row exists with `primary_goal` and `weekly_hours`.
- **Gap** — W02 extends with interests, availability and career preferences; the table is designed to be extended, not replaced.

### E16 — Governance (partial)

- **Trigger** — any material action. **Table** — `audit_events`, append-only.
- **Rules** — actor stamped from `auth.uid()`; `authenticated` holds `SELECT` only; update and delete rejected by trigger; `clock_timestamp()` keeps intra-transaction events orderable.
- **Lifecycle events captured** — `account_created`, `onboarding_started`, `onboarding_completed`, plus organization and membership changes.
- **Gap** — `landing_viewed` and `join_started` are pre-authentication and have no actor, so they need an anonymous-writable events table with its own abuse controls. Not built; deliberately not faked through the audit ledger.

## AI Tutor governance (recorded, not yet enforceable)

No tutor exists, so there is nothing to govern yet. The constraints are
recorded here so W04 implements against them: the tutor may explain, question,
hint, critique and recommend; it must never submit graded work, fabricate
assessment results, mark a skill verified, bypass human review, or create a
credential without evidence. Every material tutor action writes an audit event
carrying the actor, the approved context, the instruction version and the
structured output that passed schema validation.

## Verification chain (design fixed, unbuilt)

`skill → evidence → rubric → review → decision → verified skill → credential`,
capturing evidence source, submitter, timestamps, reviewer, rubric, decision,
rationale, status and supersession history. No model-only verification. W06.

## Matching (design fixed, unbuilt)

Matching reads persisted state only — verified skills, pathway progress,
projects, credentials, interests, availability, mentor criteria, opportunity
requirements — and every match exposes the inputs that produced it. No
unexplained ranking is presented as authoritative. W08.
