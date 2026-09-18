# BTG AI — Engine Certification

Certification: `READY` (traced UI → route → action → service → DB → authz →
transition → audit → visible outcome), `READY_WITH_GAPS`, `BLOCKED`, `MISSING`.

Engine IDs follow the repository's existing canonical set (E1–E16 in
`BTG_AI_CANONICAL.md`); the request's E01–E15 numbering maps onto it below.

| Engine | Status | UI | Backend | DB | Authz | Evidence/Audit | E2E | Gap |
|---|---|---|---|---|---|---|---|---|
| E1 Identity & Access | READY | yes | yes | yes | yes | yes | partial | Browser journey unrun without Supabase |
| E2 Learner Profile | READY_WITH_GAPS | yes | yes | yes | yes | yes | partial | Goals only; interests, availability, career prefs are W02 |
| E3 Diagnostic (baseline) | READY_WITH_GAPS | yes | yes | yes | yes | yes | partial | Adaptive probe resolves levels 0/1/2/4 only; re-assessment scheduling and operator authoring UI are later waves; browser E2E written but unrun |
| E4 Competency Graph | READY_WITH_GAPS | yes | yes | yes | yes | yes | partial | Graph, levels, prerequisites and gap read model done; taxonomy authoring UI is W10 |
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

### E3 — Diagnostic Engine

- **Primary persona** — learner; governing organizations read member baselines.
- **Trigger** — the baseline gate after onboarding, or a re-assessment.
- **Required inputs** — a published baseline diagnostic; one option selection per question.
- **State** — `diagnostic_attempts.status`: `in_progress → submitted → scored`, plus `abandoned`.
- **Allowed transitions** — registered in `btg.state_transitions` as `diagnostic_attempt`; `in_progress → scored` is rejected, so scoring is reachable only through submission.
- **Business rules** — one live attempt per learner per diagnostic (partial unique index); exactly one published baseline (partial unique index); selections must be options that exist on the question; single-choice takes exactly one answer; no second answer to the same question; grading happens server-side; the learner is never told whether an answer was right.
- **Permissions** — attempts and responses are own-row via RLS, plus operators and governing organizations for attempts. `authenticated` has **no** INSERT/UPDATE on attempts, responses or baselines: the commands are the only write path. Answer keys have no grant at all, and `diagnostic_responses.is_correct` is withheld by column-level grant.
- **Tables** — `diagnostics`, `diagnostic_questions`, `diagnostic_answer_keys`, `diagnostic_attempts`, `diagnostic_responses`, `learner_competencies`.
- **Commands** — `start_diagnostic_attempt` (resumes rather than duplicating), `next_diagnostic_question` (the adaptive walk), `answer_diagnostic_question` (grades against the hidden key), `submit_diagnostic_attempt` (estimates, writes the baseline, audits, notifies), `abandon_diagnostic_attempt`.
- **Evidence** — `diagnostic.attempt.started`, `diagnostic.attempt.scored` carrying the per-competency result; `diagnostic.attempt.abandoned`; one `baseline.scored` notification, idempotent on the attempt id.
- **Completion** — attempt `scored`, `learner_competencies` written, `profiles.baseline_completed_at` stamped.
- **Failure states** — no published baseline, attempt not owned, attempt closed, budget exhausted, invented option, duplicate answer, submit with zero answers, double submit.
- **Recovery** — an interrupted attempt resumes at the next unanswered question; an attempt whose probe finished but was never scored offers a submit step.
- **Observability** — audit events with the result payload; structured errors mapped through the domain taxonomy.
- **Tests** — 31 database tests plus 18 domain tests.

### The adaptive probe, stated plainly

Two questions per competency: an opener at level 2, then level 4 if that was right and level 1 if it was not. The estimate is the highest level answered correctly, or 0. This resolves levels 0, 1, 2 and 4 — **not** 3 or 5 — so every baseline carries a confidence figure (0.65 for a two-question probe) and is superseded by evidence in W06. The results page states this to the learner rather than presenting the level as settled.

### E4 — Competency Graph Engine

- **Primary persona** — operator governs; every persona reads.
- **State** — none; it is reference data. `competency_prerequisites` is kept acyclic by trigger, because a cycle would make W03 pathway generation non-terminating.
- **Tables** — `competency_domains`, `competencies`, `competency_levels`, `competency_prerequisites`.
- **Read model** — `learner_competency_gaps`, a `security_invoker` view so the underlying RLS decides which learners a caller sees; exposes measured level, target level, gap and the prerequisites still unmet.
- **Seeded content** — 4 domains, 8 competencies, a 5-level ladder each, 6 prerequisite edges, and a 24-question baseline. Correct answers are spread across option positions by a deterministic rotation, so the instrument cannot be scored by always picking the same slot.

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
