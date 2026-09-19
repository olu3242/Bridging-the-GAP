# BTG AI — Workflow OS (W14)

Internal architecture document. "Workflow OS" is an engineering term and never
appears on a learner-facing surface.

## The three truths

The single most important rule, and the one that shapes everything below.

| Truth | Store | Question it answers |
|---|---|---|
| **Domain state** | engine tables (`pathway_steps`, `evidence`, `applications`, …) | what *is* true |
| **Execution state** | `btg.work_queue`, and later workflow instances/work items | what should run, is waiting, or failed |
| **Evidence** | `public.audit_events` | what *happened* |

**The audit ledger must never drive orchestration.** This is not a stylistic
preference. Defect 17 in `BTG_AI_STATUS.md` was an over-broad grant that let any
learner write arbitrary rows into the ledger — proven, a learner with zero
credentials produced `credential_issued` and `opportunity_accepted` entries. As
a reporting surface that was a forgery in a timeline. Had the ledger been an
*actuator*, the same hole would have let a learner drive their own credential
issuance. Orchestration therefore reads a separate private stream that no
session role can write.

**Workflow state is a projection, not a second authority.** It is derived from
engine state plus execution state. A workflow row that can disagree with
`pathway_steps.status` is a bug generator, and the codebase already has the
right pattern twice: `learner_outcome_view` projects canonical tables and
`outcome_timeline_view` projects the ledger.

## Layers

```
EXPERIENCE     learner · reviewer · mentor · employer · operator
WORKFLOW       onboarding · diagnostic · pathway · learning · project ·
               verification · credential · mentorship · opportunity
ORCHESTRATION  instances · work items · sequencing · approvals · timers ·
               retries · escalation · compensation
GOVERNANCE     identity · membership · capabilities · RLS · policy · audit
EVIDENCE+STATE workflow state · engine state · evidence · decisions · events
RUNTIME        Postgres · queue · workers · scheduling · observability
```

## Technology decision: a portable SQL queue, not pgmq

The plan called for `pgmq` + `pg_cron` + `pg_net`. **All four of `pgmq`,
`pg_cron`, `pg_net` and `http` are absent from `pg_available_extensions` on a
bare Postgres cluster** — not merely uninstalled. The local certification
cluster and CI both run bare `postgres:16`, and all 301 tests run there.

A pgmq-based queue would therefore have had **no test coverage in the only
environment that currently works**, and could only ever have been exercised
against a hosted project — which is exactly the substrate that is currently
blocked. That trade is not worth pgmq's archive and metrics conveniences at
BTG's scale.

`btg.work_queue` uses `FOR UPDATE SKIP LOCKED`, which gives the same
claim/lease semantics, runs identically on bare 16 and hosted 17, and still
enqueues **inside the same transaction as the domain write** — the property
that makes in-database orchestration worth choosing over an external
orchestrator in the first place.

`pg_cron` is not required. It becomes one possible *invoker* of the drain, so
the scheduler choice stays open:

| Invoker | Note |
|---|---|
| `pg_cron` on a hosted project | simplest; needs the extension enabled |
| a route handler + any external scheduler | needs the service-role key server-side; keeps the runtime portable |
| an explicit admin trigger | useful for pilot operations and manual recovery |

The drain is `btg.drain_notifications(worker, batch, lease_seconds)` and is
granted to `service_role` only, so whichever invoker is chosen must hold that
role. **No invoker is wired yet** — that is the first task once the substrate
is live.

## W14-B — the execution tier (BUILT, migration 20260918003900)

Before this, BTG had no capacity to do anything asynchronously. `btg.notify`
wrote rows and nothing delivered them: nothing in 38 migrations or the
application ever set `status = 'sent'`, so every notification ever created sat
`pending` forever and the only reference to `'sent'` was an index predicate.

Shipped:

- `btg.work_queue` — durable queue with idempotency key, attempts, max_attempts,
  `available_at` backoff, lease fields and `last_error`.
- `btg.enqueue_work` — idempotent on `(queue, idempotency_key)`.
- `btg.claim_work` — one statement, `FOR UPDATE SKIP LOCKED`. Attempts increment
  **at claim time** on purpose: a worker that dies mid-item must still burn an
  attempt, or a poison item retries forever.
- `btg.complete_work`, `btg.fail_work` (backoff 5s→10s→20s… capped at an hour,
  then dead-letter), `btg.fail_work_permanently`, `btg.reap_expired_leases`.
- `btg.dispatch_notification` + `btg.drain_notifications` — the first workload.
- `btg.queue_health` — depth, backlog age and retry pressure per queue.
- `notification` registered in `btg.state_transitions` (it was the one status
  enum in the system with no machine) and mirrored in `lifecycle.ts`. The
  parity test caught the omission when only the database side was added.

**Recovery classification, as implemented.** `fail_work` is for transient
conditions and retries with backoff. `fail_work_permanently` is for conditions
retrying cannot fix. A channel with no configured provider is permanent, so an
`email` notification dead-letters on the first attempt with
`no delivery provider configured for channel email` rather than burning five
attempts pretending to have tried. Honest failure beats a retry theatre.

Certified: 16 tests in `tests/db/execution.test.ts`, plus a live proof of
idempotent enqueue, exclusive claim, backoff, dead-letter and lease reaping
against the hosted project.

Security posture: nothing in the runtime is granted to `anon` or
`authenticated` — not the table, not the view, not one function. Given that two
defects in this codebase were over-broad grants on functions intended to be
internal, the runtime is service-role-only by construction, and tests assert it
for every function by name.

## W14-C / W14-D — specified, deliberately NOT migrated

The workflow core and the private orchestration stream are designed below but
no migration exists, for one reason: **migrations here are forward-only, and
there is no consumer yet.** Shipping a guessed `workflow_instances` shape
before the substrate is live and before the coordinator exists means migrating
a table rather than editing a document. The design is cheap to change now and
expensive to change later, so it stays a design until W14-A opens.

### `workflow_definitions` / `workflow_definition_versions`

Seeded from the 16 workflow labels the ledger **already emits**:
`signup, onboarding, organization_provisioning, baseline_diagnostic,
pathway_generation, pathway, learning, projects, evidence, verification,
credentials, opportunities, matching, mentorship, tutor, notifications`.

Rules: a published version is immutable; versions are ordered; a definition is
org-scoped where the workflow is org-specific and platform-scoped otherwise.

### `workflow_instances`

Columns: durable `id`, `definition_version_id`, `organization_id`,
`subject_profile_id`, `status`, `started_at`, `settled_at`.

- **Pins its definition version.** A definition change never retroactively
  alters an in-flight instance; migrating an instance between versions is an
  explicit, recorded operation. This is the hardest problem in workflow engines
  and the rule that prevents it becoming one.
- **Never copies engine status.** No `pathway_step_status` column, ever.
- Replaces `correlation_id` as the correlation key. The existing
  `correlation_id` is generated per HTTP request (`crypto.randomUUID()` in
  `requireContext`) and used by 3 of ~30 services — it looks like this
  primitive and is not one, because it dies with the request.

### `workflow_work_items`

Types: `human`, `system`, `ai`, `approval`, `external`, `wait`. Fields: owner
(persona, AI worker or system), status, priority, deadline, attempts, payload,
result, failure.

### Private orchestration stream

`btg.orchestration_events`: `event_id`, `workflow_instance_id`,
`workflow_step_id`, `event_type`, `idempotency_key`, `payload`, `attempt`,
`occurred_at`. Writable by `service_role` only; **no session role may publish
an executable event.** Audit events stay evidence.

## AI as a worker, never an authority

The tutor already has the governance this needs (`policy_version`,
`instruction_version`, `model`, outcome taxonomy, refusal recording, overclaim
guard, deterministic fallback). As an `ai` work item it additionally carries
max attempts, a max cost, a timeout, a fallback and human escalation.

AI cannot bypass engine commands. The structural guarantee already holds:
`authenticated` has no write on `verified_skills`, `credentials`,
`learner_competencies` or `evidence`, and no tutor function body references
`diagnostic_answer_keys`.

## Configuration boundary

| Configurable | Never configurable |
|---|---|
| SLA hours, reminder cadence | no self-review |
| retry counts, timeouts | credential requires verified skills |
| priority, workflow enablement | rubric integrity thresholds (required criteria ≥ 3) |
| batch sizes, lease duration | cohort k-anonymity (≥ 5) |
| | cross-user and cross-org isolation |
| | audit integrity |
| | human verification authority |

The right-hand column is the product's trust claim. Making any of it
admin-tunable turns the differentiator into a support ticket.

## Status

**`BTG_WORKFLOW_OS_BLOCKED`** — on W14-A, externally.

| Stop condition | State |
|---|---|
| 1. live substrate certified | **BLOCKED_EXTERNAL** — egress policy denies the project host |
| 2. notifications execute through the worker | **DONE** (locally certified; live schema applied) |
| 3. durable workflow instances | specified, not built |
| 4. versioned definitions | specified, not built |
| 5. work items persist | specified, not built |
| 6. private idempotent orchestration events | specified, not built |
| 7. human queues | not built |
| 8. workflow projection inspectable | `btg.queue_health` only |
| 9. engines remain authoritative | **HOLDS** — nothing added touches engine authority |
| 10. security tests cover new runtime surfaces | **DONE** — every runtime function asserted by name |

W14-A is the gate, and it is the gate for a reason: a durable runtime built on
engines that have never executed against real Auth, real JWT, real PostgREST
and real Storage multiplies unknowns. When something stalls you cannot tell
whether it is the orchestrator or the engine.
