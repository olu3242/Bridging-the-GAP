# BTG AI — Engine Certification

Certification: `INTEGRATED` (traced UI → route → action → service → DB → authz
→ transition → audit → visible outcome, certified by automated tests against a
real Postgres cluster), `READY_WITH_GAPS`, `BLOCKED`, `MISSING`.

`LIVE_CERTIFIED` is reserved for engines re-run against a live Supabase project
in an authenticated browser. No engine holds it yet: no Supabase project is
attached to this repository.

Engine IDs follow the repository's canonical set in `BTG_AI_CANONICAL.md`.

| Engine | Status | UI | Backend | DB | Authz | Evidence/Audit | E2E | Gap |
|---|---|---|---|---|---|---|---|---|
| E1 Identity & Access | INTEGRATED | yes | yes | yes | yes | yes | db + browser (browser unrun without Supabase) | Live browser journey unrun |
| E2 Learner Profile | INTEGRATED | yes | yes | yes | yes | yes | db | Interests, availability and career preferences still out of scope |
| E3 Diagnostic (baseline) | INTEGRATED | yes | yes | yes | yes | yes | db + browser | Probe resolves levels 0/1/2/4 only; operator authoring UI not built |
| E4 Competency Graph | INTEGRATED | yes | yes | yes | yes | yes | db | Taxonomy authoring UI not built |
| E5 Pathway | INTEGRATED | yes | yes | yes | yes | yes | db | — |
| E6 Learning | INTEGRATED | yes | yes | yes | yes | yes | db | Content is seed-scale (8 modules) |
| E7 AI Tutor | INTEGRATED | yes | yes | yes | yes | yes | db + domain | Provider calls unexercised live; refusal and fallback paths certified deterministically |
| E8 Project | INTEGRATED | yes | yes | yes | yes | yes | db | — |
| E9 Evidence & Verification | INTEGRATED | yes | yes | yes | yes | yes | db | File upload path certified by contract, not by a live object store |
| E10 Credential | INTEGRATED | yes | yes | yes | yes | yes | db | Public credential verification page not built |
| E11 Mentorship | INTEGRATED | yes | yes | yes | yes | yes | db | Session scheduling is a record, not a calendar integration |
| E12 Opportunity | INTEGRATED | yes | yes | yes | yes | yes | db | Employer-side opportunity authoring UI not built (operator-writable only) |
| E13 Recommendation & Matching | INTEGRATED | yes | yes | yes | yes | yes | db | — |
| E14 Community | PILOT_SCOPE_COMPLETE | yes | yes | yes | yes | yes | db | Cohort aggregation is the intended pilot scope; peer discussion is POST_PILOT — see `BTG_AI_PILOT.md` |
| E15 Application pipeline | INTEGRATED | yes | yes | yes | yes | yes | db | Employer pipeline UI is the organizations surface; no dedicated ATS view |
| E16 Governance & Intelligence | INTEGRATED | yes | yes | yes | yes | yes | db | Pre-authentication analytics, rate limiting and error reporting still out of scope |
| E17 Outcomes & Analytics | INTEGRATED | yes | yes | yes | yes | yes | db + browser | Operator console and cross-org analytics are POST_PILOT |

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

### E5 — Pathway Engine

- **Trigger** — a scored diagnostic. **Tables** — `pathways`, `pathway_steps`, `pathway_step_dependencies`.
- **Rules** — one active pathway per learner (partial unique index); regeneration supersedes the previous plan before activating the new one, never the reverse; step order comes from the competency graph's prerequisite edges, so a step is only unlocked when what it depends on is complete.
- **Read model** — `pathway_step_view`, `security_invoker`, carrying status, depth, blocking steps and the rationale for each step.
- **Evidence** — `pathway.pathway.generated`, `pathway.step.started`, `pathway.step.completed`.

### E6 — Learning Engine

- **Tables** — `learning_modules`, `learning_activities`, `learner_module_progress`, `learner_activity_completions`.
- **Rules** — a module completes only when every one of its activities is recorded complete; progress counters are maintained by the command, never by the client.
- **Read model** — `learner_learning_view`.
- **Evidence** — `learning.activity.completed`, `learning.module.completed`.

### E7 — AI Tutor Engine

- **Governance** — `src/domain/tutor/policy.ts` holds the versioned policy and instruction, the intent set, the refusal taxonomy and the output schema. Every refusal carries an alternative the learner can act on.
- **Rules** — the tutor is given only approved context (`tutor_context`: competency, goal, measured level, module, step, activities completed) and no answer-key material; a database test asserts no `%tutor%` function body references `diagnostic_answer_keys`. `authenticated` holds no write on `verified_skills`, `credentials`, `learner_competencies` or `evidence`, so the tutor has no path to authoritative state even if its output said otherwise.
- **Output** — `messages.parse()` against a JSON schema, then an overclaim guard. A refusal is recorded as fully as an answer; a provider failure degrades to deterministic coaching assembled only from persisted records, and says so.
- **Transcript** — `tutor_turns` is append-only (update and delete both rejected) and carries `policy_version`, `instruction_version`, `model` and `ordinal`.
- **Evidence** — `tutor.session.opened`, `tutor.turn.<outcome>`; a refusal audits at `notice`, an answer at `info`.

### E8–E10 — Project, Evidence, Verification, Credential

- **Chain** — `skill → project → evidence → rubric → review → decision → verified skill → credential`, each link persisted with its actor and timestamp.
- **Rules** — no model-only verification: a `verified_skill` exists only downstream of a human reviewer's decision. A reviewer cannot review their own evidence. Approval requires every required rubric criterion scored, none below 3. A new claim supersedes the previous one rather than rewriting it. A credential issues only when every required competency is verified at or above its minimum level, and records its `issuance_basis`.
- **Visibility** — `portfolio_view` lets a learner see who reviewed their work via a narrow policy on the reviewer's profile, and nothing more.
- **Evidence** — `project.project.assigned|started|completed`, `evidence.evidence.submitted`, `verification.review.claimed|rejected|revision_required`, `verification.skill.verified`, `credential.credential.issued|revoked`.

### E11 — Mentorship Engine

- **Tables** — `mentor_profiles`, `mentor_expertise`, `mentorships`, `mentor_sessions`, `mentor_session_notes`.
- **Rules** — `recommend_mentors` explains every recommendation from the learner's measured gaps against mentor expertise. A mentor's private notes live in `mentor_session_notes` behind a row policy, because a column-level grant would have hidden them from the mentor who wrote them.
- **Evidence** — `mentorship.mentorship.requested|accepted|declined`.

### E12/E13/E15 — Opportunity, Matching, Application pipeline

- **Matching** — `btg.compute_opportunity_matches` reads persisted state only and every match enumerates both `matched` and `missing` with a stated reason per factor. A measured-but-unverified competency is reported as exactly that. Matches recompute on a new verified skill by trigger.
- **Disclosure** — an application shares only the verified skills the learner named; `application_evidence_view` shows an employer those skills with their verification chain and nothing else about the learner.
- **Pipeline** — `advance_application` moves the hiring organization's own pipeline (`under_review`, `shortlisted`, `offered`, `rejected`) and re-authorizes the caller against the opportunity's organization; a rejection requires a reason the applicant can read. `respond_to_offer` is the applicant's alone: an organization attempting `accepted` is refused with `42501`. Every move notifies the other side.
- **Evidence** — `matching.matches.computed`, `opportunity.application.submitted|under_review|shortlisted|offered|rejected|accepted|withdrawn`.

### E17 — Outcomes & Analytics

- **Principle** — no new store and no vendor. Every figure is derived from the canonical table that owns the state or from the audit ledger that recorded the transition.
- **Read models** — `learner_outcome_view` (`security_invoker`; the caller's own funnel from baseline to accepted offer) and `outcome_timeline_view` (the ledger's lifecycle actions mapped to a stable stage name and ordinal, so a UI never hardcodes an action string). A database test asserts the view's published stage names match `OUTCOME_STAGES` in TypeScript exactly.
- **Cohort aggregates** — `cohort_outcomes(cohort_id)` is a definer function, deliberately not a view over `learner_outcome_view`: a `security_invoker` view would have returned silent zeros to an organization admin, and fixing that with broad cross-learner read policies would be a privacy regression. It authorizes the caller against the cohort's organization, returns aggregates only, and refuses a cohort of fewer than five learners because an aggregate over a handful identifies the individual.
- **Project completion** — recorded by an `after update` trigger on `public.projects`, so the event follows the transition wherever it is driven from rather than only from today's one caller.
- **Dashboard rule** — the dashboard's outcome panel reads `learner_outcome_view`. The previous "what unlocks next" panel, which described shipped waves as unbuilt, was removed rather than left to drift.

## Remaining gaps, stated plainly

- No Supabase project is attached, so the browser journey specs and every RLS
  path exercised through PostgREST remain certified against a local Postgres
  cluster rather than live. This is the only thing between `INTEGRATED` and
  `LIVE_CERTIFIED`.
- E14 Community is a cohort aggregate surface only, now classified
  `PILOT_SCOPE_COMPLETE` rather than left ambiguous. There is no discussion,
  peer review or social surface, and none is faked.
- Pre-authentication analytics (`landing_viewed`, `join_started`) have no actor,
  so they would need an anonymous-writable events table with its own abuse
  controls. Not built, and deliberately not forced through the audit ledger.
- Evidence file upload is certified by contract against `file_objects`; no live
  object store has been exercised.
