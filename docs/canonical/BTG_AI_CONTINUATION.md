# Continuation baseline — 2026-09-19

Repository baseline: `a1c06e5` (W01–W14). The IDE originally checked out
`main` at `e9302b2`; `codex/btg-ai-continuation` was created from the upstream
implementation, which already contains those main-branch commits. No history
or working changes were discarded. No AGENTS.md, apps/packages workspace, or
Sites hosting configuration was present.

## Verified gap map

| Area | Code path and actual baseline | Remaining gap |
|---|---|---|
| Identity/personas | Actor capabilities, session routing, onboarding commands, tenant RLS | User/content administration surfaces remain incomplete |
| Learning | Pathway step → open_step_learning → learning_modules/activities → complete_learning_activity | Eight modules with 24 generic activities; no 112-lesson catalog |
| Curriculum | Eight competency seeds and prerequisite graph | Subject/course hierarchy, versioned curriculum, Vibe Coding absent |
| Video | learning-module renders activity.body only | No source/provider/status metadata or embedded player |
| Assessment | Private diagnostic keys, server grading, learner competencies | Learning checks are recorded reflections, not graded mastery |
| Evidence/credentials | Projects → submission → rubric review → verified skills → eligible credentials | Public verification surface; broader curriculum alignment |
| Workflow | Versioned definitions, dispatcher, human work, operator projections, learner coordinator | Extend the existing domain integration for catalog learning |
| AI | Tutor service, provider integration, refusal/fallback policy, persisted turns | Live provider verification; broader activity feedback |
| Search | No entity-search UI or query path found; searchParams are routing flags | Catalog and authorized entity search, filters and pagination |
| Production | CI applies migrations, runs domain/DB/RLS, builds, runs Playwright | Authenticated browser/provider/object-store verification not established here |

The status ledger records prior live schema parity. That is historical evidence,
not a live certification performed by this continuation. README and older engine
documentation contain stale W01/no-project descriptions.

## Local certification baseline

An isolated Docker PostgreSQL 16 instance, `btg-continuation-certification`,
binds only `127.0.0.1:55432`. The auth shim and all 51 upstream migrations
applied successfully. `npm run test:all`: **430/430 passed**, 26 files.
Initial typecheck found missing upstream dependencies and stale Next-generated
route types from the old main checkout; install the committed lockfile and
rebuild before treating those as source defects.

## Curriculum contract

The user confirmed that the 112 lessons were designed outside the repository
and must now be materialized: 100 original lessons plus D11 Vibe Coding (12).
Preserve existing IDs and progress. New curriculum requires deterministic seeds,
explicit versions/statuses and real lesson-specific instruction and practice.
Unverified videos remain `pending`; never invent metadata or imply availability.
The subsequent Batch 0 attachment supplied the exact D01–D11 allocation and
all 112 IDs/titles. It supersedes the provisional taxonomy considered during
reconnaissance. The authoritative design now lives in `curriculum/`.

## C01 — replace generic reference activities

Forward migration `20260919000100_learning_content.sql` replaces only the exact
original prompts in the eight known modules. Existing authored text survives.
All 24 activity IDs, module bindings, output requirements and completion rows
remain unchanged. Each lesson now teaches its competency, each lab requests a
specific artifact, and each reflection poses a distinct problem. Reflections
remain ungraded and cannot substitute for reviewed skill evidence.

This batch does not claim the 112-lesson curriculum or video delivery is complete.

Validation: 432 domain/database tests passed; lint, typecheck and production
build passed. Public browser regression: 14 passed, 7 authenticated tests skipped
without Supabase browser configuration. Commit: `70019ca`.

## Batch 0 — curriculum design and seed contract

The exact 112-lesson source is compiled into complete machine-readable contracts,
protected assessments, a coverage report and a rerunnable draft SQL seed.
See `curriculum/README.md` for the evidence boundary and Batch 1 handoff.
No new curriculum is published and no deployed migration history was modified.
