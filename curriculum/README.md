# BTG AI — Batch 0 curriculum contract

This directory is the authoritative, machine-readable design for the user's
exact 11-domain, 112-lesson curriculum. It is a **draft curriculum**, not a claim
that 112 lessons are published or that the new runtime is certified.

## Artifacts

| Artifact | Purpose |
|---|---|
| `source/ai.mjs`, `engineering.mjs`, `professional.mjs`, `vibe.mjs` | 112 distinct authored lesson texts, objectives, worked cases, practices and misconceptions |
| `source/catalog.mjs` | Exact domain allocation, competency taxonomy, supplemental mappings, prerequisites, synthetic fixtures, candidate videos and career tracks |
| `generated/catalog.v1.json` | Complete lesson contracts, 11 courses, 22 modules, 24 competencies, diagnostic blueprint, 11 projects and credential/career mappings |
| `generated/protected-assessments.v1.json` | Protected answer keys and assessment rubrics; server/authorized assessor use only |
| `generated/engine-contract.v1.json` | Required persistence, authorization, progression, remediation, tutor and workflow behavior; 17 negative journey cases |
| `generated/coverage.v1.json` | Reproducible structural/content coverage validation |
| `assessment-policy.mjs` | Tested pure policy functions for assessment, completion and publication; no database writes or authorization bypass |
| `../supabase/seeds/curriculum-v1.sql` | Deterministic, rerunnable **draft** seed into existing canonical domain/competency/module/activity tables |
| `video-verification.json` | Dated source/iframe browser observations, separate from deterministic curriculum data |

Answer files must never be moved under `public/`, bundled into client components,
returned by learner APIs or included in tutor context. File separation is a
design boundary; Batch 1 must also enforce database grants and server projections.

## Build and validation

```text
npm run curriculum:build
npm run curriculum:check
npm test
npm run test:db
npm run curriculum:videos
```

`curriculum:check` checks committed artifacts against their authored sources.
CI runs it before migration/database certification. The database seed test runs
the generated SQL twice inside a transaction, checks preserved legacy records
and progress, proves learner/operator draft visibility with real RLS, and rolls
back. It does not add new curriculum to a live project.

## Canonical allocation

| Domain | Lessons |
|---|---:|
| D01 AI Foundations | 12 |
| D02 AI Productivity | 10 |
| D03 Prompt & Context Engineering | 10 |
| D04 AI Agents & Automation | 10 |
| D05 Software Engineering | 14 |
| D06 Data & Analytics | 10 |
| D07 Cloud & Modern Technology | 8 |
| D08 Cybersecurity & Responsible AI | 10 |
| D09 Career & Professional Skills | 8 |
| D10 Entrepreneurship & Innovation | 8 |
| D11 Vibe Coding | 12 |
| **Total** | **112** |

The legacy `applied-ai` competency domain is retained for historical references.
It is outside the 11-domain canonical curriculum allocation. Existing slugs
resolve existing IDs; the seed never deletes or rewrites historical records.

## Learning and assessment design

Every lesson has an objective, three measurable outcomes, original instruction,
a worked example, active practice with synthetic starter material, hints,
submission requirements, a two-question checkpoint, competency links and explicit
completion/remediation rules. The checkpoint combines a server-graded true/false
probe with a practical or project response that requires independent human
review. A single recognition answer cannot demonstrate applied capability.

Rubric criteria require at least 3/4 each and at least 75% overall; the closed
question must be correct. Integrity and unresolved security failures block a
pass. Three attempts are allowed per cycle, with remediation before retry and
audited instructor intervention before a new cycle. Old attempts remain intact.

The 24 diagnostic probes reuse explicit question/key references and estimate
only awareness (0/1). They are deliberately bounded baseline estimates, not
claims of diagnostic psychometric validation or verified proficiency.

All domains end in an independently reviewed project. Project competency checks
cover the domain's mapped capabilities and require links to supporting lesson
artifacts plus application in the project. Project submission is unlocked by
prior lessons; it does not depend on its own approval or course completion.
This avoids a circular final-lesson gate. CL08 and VC12 require actual deployment
evidence for project approval. An unexecuted plan may be saved but cannot pass
an execution requirement.

## Videos and publication

The eight supplied YouTube IDs are candidate assets with 13 candidate lesson
mappings. No transcripts, chapter boundaries, durations or verified timestamps
were invented. Source-page resolution and an iframe poster do not certify
playback, relevance or accessibility. Browser observations are retained without
automatically promoting health status.

All 101 non-project lessons currently require video; 11 project lessons do not.
All 112 lessons remain draft. Required video publication checks fail closed until
identity, actual playback, embedding, relevance, real metadata, accessibility and
rendering are verified. Eighty-eight required-video lessons do not yet have a
candidate mapping. Pending assets do not imply dead videos.

The probe uses actual iframes on a local HTTP origin. Direct navigation to an
embed URL is not a valid embedding test: YouTube requires client identification
through the referrer context. See the official
[YouTube player reference](https://developers.google.com/youtube/iframe_api_reference).

## Batch 1 handoff and certification boundary

Do not execute the seed against a live project until Batch 1 implements the
version, assessment and publication guards in `engine-contract.v1.json`.
The seed intentionally uses existing `learning_modules` / `learning_activities`
instead of a parallel progress engine. Course/version metadata, private lesson
assessments, attempts and media mappings need additive persistence extensions.
The generated JSON defines those contracts; the SQL seeds only columns that
already exist. New draft-only competencies must not create impossible pathway
steps before their content is published.

Existing W01–W14 golden journeys and the new policy tests verify useful parts of
the design. They do **not** certify the new 112-lesson browser journey. Batch 2
must run student, instructor and admin journeys against real persisted state,
including a verified video, assessment failure/retry, review, evidence and
credential issuance. All 17 required negative cases are specified; only cases
covered by executable tests should be reported as tested.

Next: **Batch 1 — Build + Seed**, using these contracts without inventing a new
curriculum or weakening the existing evidence and workflow boundaries.
