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

## W14-D — the private orchestration stream (BUILT, migration 20260918004100)

`btg.orchestration_events`: `event_id`, `workflow_instance_id`, `work_item_id`,
`step_key`, `event_type`, `idempotency_key`, `source`, bounded `payload`,
`attempt`, `occurred_at`. Three properties, each enforced structurally rather
than by convention:

- **Trusted-only.** `grant select, insert … to service_role` and nothing else.
  No session role may publish an executable event. A grant, not an RLS policy,
  because a policy is a filter and a missing grant is a wall.
- **Append-only.** A `btg.reject_mutation` trigger on UPDATE and DELETE. It
  raises `restrict_violation` (23001) — worth writing down, because the obvious
  guess is 42501 and a test that asserts the wrong code passes for the wrong
  reason.
- **Idempotent.** A unique `idempotency_key`. A duplicate publish is absorbed,
  not deduplicated later by a reader.

The transition, the event and the queue row are one transaction. Never
commit-then-enqueue: that leaves a window in which the domain moved and the
continuation does not exist.

### One dispatcher, and no dynamic SQL

`btg.dispatch_workflow_work(p_worker, p_batch, p_lease_seconds, p_instance_id)`
is the only executor. Per item: claim under lease (`FOR UPDATE SKIP LOCKED`) →
emit event → load the instance's **pinned** definition version → read the
relational step → validate lifecycle → resolve the handler against
`btg.workflow_handlers` → invoke the governed command through
`btg.invoke_domain_command` → evaluate the completion check → advance → enqueue
what is now ready.

`invoke_domain_command` is a hardcoded `CASE` over command names that are
foreign-keyed to `btg.workflow_commands`. **A payload never names a function.**
There is no `execute format(…)` anywhere in the dispatch path, so a step
definition cannot become an arbitrary code-execution primitive — and a DO block
in the migration asserts that every allowlisted command has a branch, so the
allowlist cannot drift ahead of the implementation either.

`btg.workflow_commands.requires_session_actor` carries the other half of the
rule: **the runtime is a worker, never an actor.** A trigger refuses any step
naming a command that needs a session actor. Defect 20 was the generalised
version of this — the guard originally checked `public.record_audit_event` and
missed `public.enqueue_notification`, so `generate_pathway_for` aborted under a
worker. The guard now discovers session-only writers from `pg_proc`, and a
behavioural test runs the path with no session at all.

### W14-D proof

Certified in `tests/db/orchestration.test.ts` (35): duplicate event absorbed,
duplicate queue delivery executing once, two concurrent workers on one item,
crash before and after claim, lease expiration and reaping, crash after domain
success but before ACK (the domain state stands and the retry is a no-op),
retry with exponential backoff, poison item to dead-letter, durable wait and
resume.

Defects 22 and 28 came out of this: deadline breach and dead-lettering both
routed through `btg.fail_work_item`, which *retries*. Terminal failure now goes
through `btg.abandon_work_item`. A retry loop on a permanently failed item is
the kind of defect that looks like a stall in production.

## Application convergence — one product, not a platform beside it

Diagnostic → Pathway runs through the existing engines, driven by three
session-scoped entry points (`public.ensure_my_workflow`,
`signal_my_workflows`, `advance_my_workflows`) and `public.my_workflow_state`.
There is **no separate Workflow OS UI**: the learner sees a journey panel, the
reviewer/mentor/employer see a work queue in the surface they already use, and
the operator console is the only new route because operators are the only
persona whose job is the runtime itself.

Refresh, retry and duplicate submit do not duplicate effects: the instance is
keyed by an idempotency key, the queue row is keyed by one, and the completion
check is re-evaluated rather than trusted. `continueLearnerWork` does not throw
— a stalled runtime degrades to "nothing new yet", never to a 500.

Two pre-existing defects surfaced here. Defect 21: `generate_pathway`'s
empty-plan branch activated a pathway with no ledger entry, and
`learner_has_active_pathway` accepted a pathway with zero steps. Defect 29:
learner timelines omitted events acted by a reviewer, mentor or employer,
because the ledger's `actor_profile_id` answers "who acted" and a timeline needs
"whose outcome is this" — closed by `btg.stamp_outcome_subject`, which derives
`metadata.subject` from the object at insert, and a timeline view that prefers
it.

## W14-E — human work (BUILT, migrations 20260918004300/4310/4320/4330)

`workflow_work_items` from W14-C carries human work too. **No second task
system**, no placeholder queue.

Claiming is one atomic `UPDATE` guarded by `status in ('ready','escalated') and
claimed_by is null`, so one owner wins under concurrency without an advisory
lock. Deadlines, SLA, escalation (`btg.escalate_overdue_work`), reassignment and
idempotent completion are all there, and notification goes out through W14-B.

**Human completion invokes the authoritative engine command.** Completing a work
item never manufactures a domain outcome: `btg.complete_work_item` refuses
unless `btg.assert_step_satisfied` can see the domain state the step claims.
A reviewer's decision is `public.decide_review`; the work item merely records
that the human did their part.

The rule nobody can configure away:

```sql
-- Not configurable, not waivable, and it applies to operators too:
-- an operator reviewing their own evidence is still self-review.
if v_instance.subject_profile_id = p_claimant then
  raise exception 'nobody may take human work on their own run'
    using errcode = '42501';
end if;
```

Four defects came out of the visibility work, all of them the same shape — a
predicate that was wrong in the permissive or the restrictive direction and
would not have been caught by reading it. Defect 24: a reviewer could not see
persona-owned work. Defect 25: signalling did not bind human or pending steps.
Defect 26: reassignment violated `work_item_persona_owner`. Defect 27: a policy
wrote `w.workflow_instance_id = id`, which bound `id` to the subquery's own
table and was therefore *always false* — the policy denied everything, silently.

## W14-F — the operator control plane (BUILT, migration 20260918004400)

Four projections, answering the ten questions an operator actually has:
`workflow_instance_view` (where is this, what completed, what is executing, why
is it waiting, in plain language), `workflow_timeline_view`,
`workflow_work_queue_view` (who owns it next, attempts, SLA risk) and
`workflow_blockers_view` (what failed, with severity).

**Views are projections, never authority, and never an RLS bypass.** Where a
view must read the private orchestration stream it does so through a narrow
SECURITY DEFINER predicate (`btg.last_event_at`, `btg.check_requires_subject`)
rather than by dropping `security_invoker` on the whole view — because a
`security_invoker` view over `btg.orchestration_events` fails for *every*
caller, `service_role` included, and the tempting fix is the one that opens the
table. `tests/db/grants.test.ts` asserts `security_invoker` on every view and
holds the definer exceptions in an explicit allowlist with their predicates, so
the exception is enumerated rather than assumed.

## W14-G — `BTG_LEARNER_TO_OPPORTUNITY` (BUILT, migration 20260918004500)

One published definition, 14 steps, signup → onboarding → diagnostic → pathway
→ learning → project → evidence → review → verified skill → credential →
matching → application → employer decision → outcome. It **duplicates no E1–E17
logic**: every step names an allowlisted governed command and a completion check
that reads the domain.

Human and external steps are durable waits, not polls. In-flight instances pin
their definition version, and publishing a new version supersedes the old for
*new* instances only — there is no silent workflow-version mutation. Optional
steps skip through `btg.skip_work_item` rather than blocking a run on a step the
learner legitimately does not need.

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

**`BTG_WORKFLOW_OS_READY_WITH_BLOCKERS`** — implementation complete and
certified locally; live certification of the substrate remains external.

| Stop condition | State |
|---|---|
| 1. live substrate certified | **BLOCKED_EXTERNAL** — egress policy denies the project host (Auth, JWT, PostgREST, Storage, deployed invoker) |
| 2. notifications execute through the worker | **DONE** (W14-B) |
| 3. durable workflow instances | **DONE** (W14-C) |
| 4. versioned definitions | **DONE** (W14-C: immutable, monotonic, pinned) |
| 5. work items persist | **DONE** (W14-C) |
| 6. private idempotent orchestration events | **DONE** (W14-D) |
| 7. human queues | **DONE** (W14-E), including the self-review rule |
| 8. workflow projection inspectable | **DONE** (W14-F: four projections, no new authority) |
| 9. engines remain authoritative | **HOLDS** — every mutation still goes through a governed engine command |
| 10. security tests cover new runtime surfaces | **DONE** — 430 tests, every runtime function asserted by name |

Schema convergence is measured rather than asserted: the eleven-section
fingerprint in `scripts/schema-fingerprint.sql` returns **identical output on
the local certification cluster and the hosted project**, section 11 covering
the privileges a not-yet-created object would inherit.

W14-A is still the gate, and for the original reason: a durable runtime built on
engines that have never executed against real Auth, real JWT, real PostgREST
and real Storage multiplies unknowns, and when something stalls you cannot tell
whether it is the orchestrator or the engine. What changed is that everything
independently testable has been tested — W14-A is a release gate, not a reason
to stop implementing.
