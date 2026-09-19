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

## W14-C — the workflow core (BUILT, migration 20260918004000)

Five tables in `public` under RLS, two allowlist tables in `btg`, and nine
service-role functions. The earlier decision to leave this as a design was
reversed for a good reason: the batch gate was "W14-B green", not "W14-A open",
and the shape stopped being a guess once there was a concrete workload to build
it against.

### `workflow_definitions` / `workflow_definition_versions` / `workflow_definition_steps`

Seeded from the 16 workflow labels the ledger **already emits**, plus the
reserved coordinator `BTG_LEARNER_TO_OPPORTUNITY`. The labels live in
`btg.workflow_taxonomy` and are foreign-keyed, so a definition cannot file
evidence under a label the ledger does not recognise.

- A **published version is immutable.** A trigger permits exactly one change to
  it — supersession — and refuses everything else, including deletion. The step
  catalog freezes with its version.
- **Versions are monotonic.** A trigger assigns `max + 1` and rejects a chosen
  number, so two people cannot both create "version 3".
- **At most one published version** per definition, by partial unique index.
- Publishing refuses a version with no steps (it would complete on creation) or
  with a gap in its ordinals (the next step would be ambiguous).
- Only `baseline_diagnostic` is enabled and versioned. The other 15 plus the
  coordinator are *reserved*: a definition with no published version cannot be
  instantiated, which is the right default for a batch that has not landed.

The step catalog is a **table**, not a jsonb spec. That is deliberate: a jsonb
spec would have to be interpreted at run time, and interpreting a payload is
how a dispatcher ends up executing something a payload named. A step names a
`handler` and a `completion_check`, both enum or foreign-keyed, and
`btg.start_workflow` refuses any handler no dispatcher resolves yet.

### `workflow_instances`

Durable `id`, `definition_version_id`, `status`, `organization_id`,
`subject_profile_id`, `idempotency_key`, `started_at`, `settled_at`, `failure`.

- **Pins its definition version.** A trigger refuses to change
  `definition_version_id` at all, so a definition change can never retroactively
  alter an in-flight run and no instance silently migrates. Moving one between
  versions would be an explicit recorded operation; it is not implemented, so it
  is refused rather than half-available.
- **Never copies engine status.** A test asserts no workflow table carries a
  domain enum: the only `btg_*` types present are the seven runtime enums and
  `btg_persona`.
- Replaces `correlation_id` as the correlation key. The existing
  `correlation_id` is generated per HTTP request (`crypto.randomUUID()` in
  `requireContext`) and used by 3 of ~30 services — it looks like this
  primitive and is not one, because it dies with the request.

### `workflow_work_items`

Types `human`, `system`, `ai`, `approval`, `external`, `wait`; owner as system,
AI, persona or profile; priority, `available_at`, `deadline_at` derived from the
step's SLA, attempts, bounded `input`/`result` (8 KiB each, enforced), failure,
`idempotency_key`, lease columns, and `(subject_type, subject_id)`.

That last pair is the rule about not duplicating domain data, made structural:
the work item **references** the entity its step concerns and stores nothing
about it. A test asserts the `input` stays empty on the diagnostic walk.

### The projection guarantee

This is the part worth reading. `btg.complete_work_item` will not mark an item
completed unless the domain **already shows** the state its step requires:

```
step.completion_check -> btg.assert_step_satisfied(check, subject_type, subject_id, subject_profile)
                      -> a hardcoded CASE over allowlisted checks
                      -> reads the engine's own table
```

So the workflow cannot assert that a learner did something the engines do not
record. Proved three ways in the suite: completing `attempt_scored` while the
attempt is still `in_progress` is refused; binding another learner's attempt is
refused, because the check matches on `profile_id` too; and a check pointed at
the wrong kind of entity is refused before it runs.

`btg.assert_step_satisfied` contains no dynamic SQL. A step names a label, the
label is foreign-keyed to `btg.workflow_checks`, and adding one is a migration.
That is the point.

### W14-C proof

`tests/db/workflow.test.ts`, 41 tests. The positive walk is the contract's
chain, end to end, on real engine state:

```
definition -> published v1 -> instance (3 work items, first ready)
  -> learner calls start_diagnostic_attempt            (governed command)
  -> bind attempt, complete item 1                     -> item 2 ready
  -> learner answers + submit_diagnostic_attempt       (engine grades, estimates,
                                                        writes the baseline)
  -> complete item 2 (attempt is 'scored')             -> item 3 ready
  -> complete item 3 (baseline in learner_competencies)-> instance completed
  -> 5 ledger events, every one attributed to the runtime, not the learner
```

The diagnostic engine is authoritative throughout: the workflow starts no
attempt, answers no question, grades nothing and writes no competency. It waits
and records.

### Evidence, and why the runtime needed its own writer

`public.record_audit_event` requires an authenticated actor — correctly, since
it is the session-facing path, and 003800 closed it to sessions entirely. A
worker has no session, so the runtime writes through
`btg.record_workflow_event`: same shape, `actor_profile_id` null, and
`metadata.actor = 'workflow_runtime'`. A runtime action is therefore never
attributed to a learner who did not take it, and the function is service-role
only — a test proves a session calling it gets 42501.

## W14-D — the private orchestration stream (specified, next)

`btg.orchestration_events`: `event_id`, `workflow_instance_id`,
`work_item_id`, `step_key`, `event_type`, `idempotency_key`, `source`,
bounded `payload`, `attempt`, `occurred_at`. Writable by `service_role` only;
**no session role may publish an executable event**, enforced by grant and not
by RLS alone. Audit events stay evidence.

The dispatcher claims from `btg.work_queue` (W14-B, no second queue), loads the
instance's pinned version, validates lifecycle, resolves the step's allowlisted
handler, executes, records, advances, and enqueues the continuation in the same
transaction as the state change — never commit-then-enqueue, which leaves a
window where work is lost.

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
| 3. durable workflow instances | **DONE** (W14-C) |
| 4. versioned definitions | **DONE** (W14-C: immutable, monotonic, pinned) |
| 5. work items persist | **DONE** (W14-C) |
| 6. private idempotent orchestration events | specified, W14-D next |
| 7. human queues | not built (W14-E) |
| 8. workflow projection inspectable | `btg.queue_health` + the workflow tables; the operator views are W14-F |
| 9. engines remain authoritative | **HOLDS** — nothing added touches engine authority |
| 10. security tests cover new runtime surfaces | **DONE** — every runtime function asserted by name, in W14-B and W14-C |

W14-A is the gate, and it is the gate for a reason: a durable runtime built on
engines that have never executed against real Auth, real JWT, real PostgREST
and real Storage multiplies unknowns. When something stalls you cannot tell
whether it is the orchestrator or the engine.
