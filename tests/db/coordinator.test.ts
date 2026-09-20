import { describe, expect, it } from "vitest";
import {
  asServiceRole,
  asUser,
  assignProject,
  completeOnboarding,
  createOrganizationAs,
  createUser,
  decideReview,
  expectRejection,
  grantPersona,
  makeReviewer,
  openReviewFor,
  pathwaySteps,
  completeStepLearning,
  scoresFor,
  sql,
  submitEvidence,
  walkBaseline,
} from "./helpers";

const nonce = () => Math.random().toString(36).slice(2, 10);
const COORDINATOR = "BTG_LEARNER_TO_OPPORTUNITY";

/** The continuation the application runs: declare, signal, drain. */
async function nudge(userId: string) {
  return asUser(userId, async (client) => {
    await client.query("select public.ensure_my_workflow($1)", [COORDINATOR]);
    await client.query("select public.signal_my_workflows(null, null)");
    const r = await client.query("select * from public.advance_my_workflows(5)");
    return r.rows[0] as Record<string, number>;
  });
}

async function coordinatorFor(userId: string) {
  const [row] = await sql<{ id: string; status: string }>(
    `select i.id, i.status::text as status from public.workflow_instances i
     join public.workflow_definition_versions v on v.id = i.definition_version_id
     join public.workflow_definitions d on d.id = v.definition_id
     where i.subject_profile_id = $1 and d.key = $2`,
    [userId, COORDINATOR],
  );
  return row ?? null;
}

async function stageOf(instanceId: string) {
  const [row] = await sql<{
    current_step: string | null;
    waiting_on: string;
    steps_completed: number;
    instance_status: string;
  }>(
    `select current_step, waiting_on, steps_completed, instance_status
     from public.workflow_instance_view where instance_id = $1`,
    [instanceId],
  );
  return row;
}

async function statusesOf(instanceId: string) {
  const rows = await sql<{ step_key: string; status: string }>(
    `select w.step_key, w.status::text as status from public.workflow_work_items w
     join public.workflow_instances i on i.id = w.workflow_instance_id
     join public.workflow_definition_steps s
       on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
     where w.workflow_instance_id = $1 order by s.ordinal`,
    [instanceId],
  );
  return rows;
}

/** Expires the deadline of whatever optional stage is currently waiting. */
async function timeOutCurrentStage(instanceId: string) {
  await sql(
    `update public.workflow_work_items
     set deadline_at = now() - interval '1 hour'
     where workflow_instance_id = $1 and status = 'ready'`,
    [instanceId],
  );
  await sql(
    `update btg.work_queue set available_at = now()
     where queue = 'workflow' and status = 'queued' and payload->>'instance_id' = $1`,
    [instanceId],
  );
}

describe("BTG_LEARNER_TO_OPPORTUNITY", () => {
  it("is published, reserved for one run per learner, and reimplements nothing", async () => {
    const [definition] = await sql<{
      version: number;
      steps: string;
      waits: string;
      commands: string;
      human: string;
    }>(
      `select v.version,
              count(*)::text as steps,
              count(*) filter (where s.handler = 'await_domain_state')::text as waits,
              count(*) filter (where s.handler = 'domain_command')::text as commands,
              count(*) filter (where s.item_type in ('human','approval'))::text as human
       from public.workflow_definition_steps s
       join public.workflow_definition_versions v on v.id = s.definition_version_id
       join public.workflow_definitions d on d.id = v.definition_id
       where d.key = $1 and v.status = 'published'
       group by v.version`,
      [COORDINATOR],
    );
    expect(Number(definition.steps)).toBe(14);
    expect(Number(definition.waits)).toBe(12);
    expect(Number(definition.commands)).toBe(2);
    // No reviewer queue of its own: the verification workflow owns that.
    expect(Number(definition.human)).toBe(0);

    // Every command it names is allowlisted and worker-drivable.
    const rows = await sql<{ name: string }>(
      `select distinct s.domain_command as name
       from public.workflow_definition_steps s
       join public.workflow_definition_versions v on v.id = s.definition_version_id
       join public.workflow_definitions d on d.id = v.definition_id
       where d.key = $1 and s.domain_command is not null
         and s.domain_command not in (
           select name from btg.workflow_commands where not requires_session_actor)`,
      [COORDINATOR],
    );
    expect(rows).toEqual([]);
  });

  it("carries one learner from sign-up to an accepted offer", async () => {
    const learner = await createUser(`co-learner-${nonce()}`);
    const reviewer = await makeReviewer(`co-rev-${nonce()}`);
    const mentor = await createUser(`co-mentor-${nonce()}`);
    await grantPersona(mentor.id, "mentor");

    // --- sign-up ---------------------------------------------------------
    await nudge(learner.id);
    const run = await coordinatorFor(learner.id);
    expect(run).not.toBeNull();
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "onboarded" });

    // --- onboarding ------------------------------------------------------
    await completeOnboarding(learner.id);
    await nudge(learner.id);
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "baseline_measured" });

    // --- diagnostic ------------------------------------------------------
    await walkBaseline(learner.id, { correctly: false });
    await nudge(learner.id);
    // The pathway step is a domain command, so it ran in the same pass.
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "learning_started" });
    const [pathway] = await sql<{ id: string }>(
      "select id from public.pathways where profile_id = $1 and status = 'active'",
      [learner.id],
    );
    expect(pathway).toBeTruthy();

    // --- learning (optional stage, taken) --------------------------------
    const steps = await pathwaySteps(learner.id, pathway.id);
    const openStep = steps.find((s) => s.status === "available") ?? steps[0];
    await completeStepLearning(learner.id, openStep.id);
    await nudge(learner.id);
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "project_assigned" });

    // --- project + evidence ----------------------------------------------
    // A standalone brief: the evidence-first entry the projects engine allows,
    // and it keeps the proof independent of which competency the open step
    // happens to target.
    const projectId = await assignProject(learner.id, "brief-prompt-design");
    await nudge(learner.id);
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "evidence_submitted" });

    const evidenceId = await submitEvidence(learner.id, projectId);
    await nudge(learner.id);
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "skill_verified" });

    // --- verification, through the reviewer's own engine command ----------
    const reviewId = await openReviewFor(evidenceId);
    await asUser(reviewer.id, (client) =>
      client.query("select public.claim_review($1)", [reviewId]),
    );
    await decideReview(reviewer.id, reviewId, "approved", undefined, await scoresFor(evidenceId, 4));
    await nudge(learner.id);

    // The credential stage is optional; whether it is satisfied depends on
    // whether this one skill completed a whole definition.
    let stage = await stageOf(run!.id);
    expect(["credential_issued", "mentorship_matched"]).toContain(stage.current_step);

    if (stage.current_step === "credential_issued") {
      await timeOutCurrentStage(run!.id);
      await asUser(learner.id, (client) =>
        client.query("select * from public.advance_my_workflows(5)"),
      );
      stage = await stageOf(run!.id);
    }
    expect(stage.current_step).toBe("mentorship_matched");

    // --- mentorship (optional stage, taken) ------------------------------
    await sql(
      `insert into public.mentor_profiles (profile_id, headline, monthly_capacity, is_accepting)
       values ($1, 'Works in the field', 3, true)`,
      [mentor.id],
    );
    await sql(
      "insert into public.mentor_expertise (profile_id, competency_id) values ($1, $2)",
      [mentor.id, openStep.competency_id],
    );
    const mentorshipId = await asUser(learner.id, async (client) => {
      const r = await client.query(
        "select (public.request_mentorship($1, $2, $3)).id as id",
        [mentor.id, openStep.competency_id, "I would like help with this."],
      );
      return r.rows[0].id as string;
    });
    await asUser(mentor.id, (client) =>
      client.query("select public.respond_to_mentorship($1, true, $2)", [
        mentorshipId,
        "Happy to help — let us start next week.",
      ]),
    );
    await nudge(learner.id);

    // matches_computed is a domain command, so it ran in the same pass.
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "applied" });
    const [{ matches }] = await sql<{ matches: string }>(
      "select count(*)::text as matches from public.opportunity_matches where profile_id = $1",
      [learner.id],
    );
    expect(Number(matches)).toBeGreaterThan(0);

    // --- application ------------------------------------------------------
    const [opportunity] = await sql<{ id: string }>(
      "select id from public.opportunities where status = 'open' limit 1",
    );
    const applicationId = await asUser(learner.id, async (client) => {
      const r = await client.query(
        "select (public.apply_to_opportunity($1, $2, null)).id as id",
        [opportunity.id, "I have verified evidence for this work."],
      );
      return r.rows[0].id as string;
    });
    await nudge(learner.id);
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "decision_received" });

    // --- the employer's decision, then the learner's ----------------------
    const operator = await createUser(`co-op-${nonce()}`);
    await grantPersona(operator.id, "operator");
    // The pipeline is a state machine: submitted -> under_review -> shortlisted
    // -> offered. The employer walks it, step by step, as the engine requires.
    for (const [status, note] of [
      ["under_review", "Reading the evidence now."],
      ["shortlisted", "Shortlisted on verified prompting work."],
      ["offered", "We would like to offer you the placement."],
    ] as const) {
      await asUser(operator.id, (client) =>
        client.query("select public.advance_application($1, $2, $3)", [
          applicationId,
          status,
          note,
        ]),
      );
    }
    await nudge(learner.id);
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "outcome_recorded" });

    await asUser(learner.id, (client) =>
      client.query("select public.respond_to_offer($1, true)", [applicationId]),
    );
    await nudge(learner.id);

    // --- the whole run is done -------------------------------------------
    const final = await stageOf(run!.id);
    expect(final.instance_status).toBe("completed");
    expect(Number(final.steps_completed)).toBeGreaterThanOrEqual(13);

    const statuses = await statusesOf(run!.id);
    for (const step of statuses) {
      expect(["completed", "cancelled"], `${step.step_key} is ${step.status}`).toContain(
        step.status,
      );
    }

    // The engines produced every fact; the coordinator produced none of them.
    const [domain] = await sql<{
      competencies: string;
      skills: string;
      applications: string;
    }>(
      `select
         (select count(*)::text from public.learner_competencies where profile_id = $1) as competencies,
         (select count(*)::text from public.verified_skills where profile_id = $1 and revoked_at is null) as skills,
         (select count(*)::text from public.applications where profile_id = $1 and status = 'accepted') as applications`,
      [learner.id],
    );
    expect(Number(domain.competencies)).toBeGreaterThan(0);
    expect(Number(domain.skills)).toBeGreaterThan(0);
    expect(Number(domain.applications)).toBe(1);

    // Lineage: the learner's timeline reads as the journey, in order.
    const timeline = await asUser(learner.id, (client) =>
      client.query(
        `select outcome from public.outcome_timeline_view
         where profile_id = $1 order by stage`,
        [learner.id],
      ),
    );
    const outcomes = timeline.rows.map((r) => r.outcome as string);
    for (const expected of [
      "onboarded",
      "baseline_measured",
      "pathway_generated",
      "evidence_submitted",
      "skill_verified",
      "opportunity_applied",
      "opportunity_offered",
      "opportunity_accepted",
    ]) {
      expect(outcomes, `timeline is missing ${expected}`).toContain(expected);
    }
  });

  it("skips an optional stage on its deadline and records that it did", async () => {
    const learner = await createUser(`co-skip-${nonce()}`);
    await completeOnboarding(learner.id);
    await walkBaseline(learner.id, { correctly: false });
    await nudge(learner.id);

    const run = await coordinatorFor(learner.id);
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "learning_started" });

    await timeOutCurrentStage(run!.id);
    await asUser(learner.id, (client) =>
      client.query("select * from public.advance_my_workflows(5)"),
    );

    const statuses = await statusesOf(run!.id);
    const learning = statuses.find((s) => s.step_key === "learning_started");
    expect(learning!.status).toBe("cancelled");

    // Cancelled, not failed: the run went on.
    const stage = await stageOf(run!.id);
    expect(stage.instance_status).not.toBe("failed");
    expect(stage.current_step).toBe("project_assigned");

    const [{ result }] = await sql<{ result: { skipped: boolean; reason: string } }>(
      `select result from public.workflow_work_items w
       where w.workflow_instance_id = $1 and w.step_key = 'learning_started'`,
      [run!.id],
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/optional stage timed out/);
  });

  it("never lets a mandatory stage be skipped", async () => {
    const learner = await createUser(`co-mandatory-${nonce()}`);
    await completeOnboarding(learner.id);
    await walkBaseline(learner.id, { correctly: false });
    await nudge(learner.id);
    const run = await coordinatorFor(learner.id);

    // Walk to the mandatory project stage.
    await timeOutCurrentStage(run!.id);
    await asUser(learner.id, (client) =>
      client.query("select * from public.advance_my_workflows(5)"),
    );
    expect(await stageOf(run!.id)).toMatchObject({ current_step: "project_assigned" });

    // Time it out: a mandatory stage fails the run rather than moving on.
    await timeOutCurrentStage(run!.id);
    await sql(
      `update public.workflow_work_items set deadline_at = now() - interval '1 hour'
       where workflow_instance_id = $1 and step_key = 'project_assigned'`,
      [run!.id],
    );
    await asServiceRole((client) =>
      client.query("select btg.enqueue_workflow_step(w.id, interval '0', 'probe') from public.workflow_work_items w where w.workflow_instance_id = $1 and w.step_key = 'project_assigned'", [run!.id]),
    );
    await asUser(learner.id, (client) =>
      client.query("select * from public.advance_my_workflows(5)"),
    );

    const stage = await stageOf(run!.id);
    expect(stage.instance_status).toBe("failed");
    expect(stage.waiting_on).toMatch(/deadline passed waiting for learner_has_project/);
  });

  it("keeps one run per learner however many times the application asks", async () => {
    const learner = await createUser(`co-once-${nonce()}`);
    for (let attempt = 0; attempt < 3; attempt += 1) await nudge(learner.id);
    const [{ n }] = await sql<{ n: string }>(
      `select count(*)::text as n from public.workflow_instances i
       join public.workflow_definition_versions v on v.id = i.definition_version_id
       join public.workflow_definitions d on d.id = v.definition_id
       where i.subject_profile_id = $1 and d.key = $2`,
      [learner.id, COORDINATOR],
    );
    expect(Number(n)).toBe(1);
  });

  it("pins its version, so a later definition never rewrites a run in flight", async () => {
    const learner = await createUser(`co-pin-${nonce()}`);
    await nudge(learner.id);
    const run = await coordinatorFor(learner.id);

    // The run started on the coordinator's published version.
    const [pinned] = await sql<{ version_id: string; version: number }>(
      `select i.definition_version_id as version_id, v.version
       from public.workflow_instances i
       join public.workflow_definition_versions v on v.id = i.definition_version_id
       join public.workflow_definitions d on d.id = v.definition_id
       where i.id = $1 and d.key = $2`,
      [run!.id, COORDINATOR],
    );
    expect(pinned.version).toBe(1);

    // Nothing can move it -- not to another version of anything.
    const [other] = await sql<{ id: string }>(
      `insert into public.workflow_definition_versions (definition_id)
       select id from public.workflow_definitions where key = $1 returning id`,
      [COORDINATOR],
    );
    const rejection = await expectRejection(
      sql("update public.workflow_instances set definition_version_id = $1 where id = $2", [
        other.id,
        run!.id,
      ]),
    );
    expect(rejection.code).toBe("42501");

    // And the version it pins cannot change underneath it: a published
    // version is immutable and its step catalog is frozen.
    const notes = await expectRejection(
      sql("update public.workflow_definition_versions set notes = 'rewritten' where id = $1", [
        pinned.version_id,
      ]),
    );
    expect(notes.code).toBe("42501");

    const frozen = await expectRejection(
      sql(
        `insert into public.workflow_definition_steps
           (definition_version_id, step_key, ordinal, item_type, handler, completion_check)
         values ($1, 'sneaked_in', 99, 'system', 'await_domain_state', 'learner_profile_exists')`,
        [pinned.version_id],
      ),
    );
    expect(frozen.code).toBe("42501");

    // The draft above is left unpublished on purpose: publishing it would
    // supersede the coordinator for every other test in this database, and a
    // publish cannot be undone -- which is the guarantee being tested.
    const [{ status }] = await sql<{ status: string }>(
      "select status::text as status from public.workflow_definition_versions where id = $1",
      [other.id],
    );
    expect(status).toBe("draft");
  });

  it("is not an organization's to start for somebody", async () => {
    const owner = await createUser(`co-org-${nonce()}`);
    await createOrganizationAs(owner.id, `co-org-${nonce()}`);
    const rejection = await asUser(owner.id, (client) =>
      expectRejection(
        client.query("select public.ensure_my_workflow($1)", ["organization_provisioning"]),
      ),
    );
    expect(rejection.code).toBe("42501");
  });
  it("gives the learner their own journey to read, and nobody else's", async () => {
    const learner = await createUser(`co-read-${nonce()}`);
    const stranger = await createUser(`co-read-other-${nonce()}`);
    await completeOnboarding(learner.id);
    await nudge(learner.id);
    const run = await coordinatorFor(learner.id);

    // The same projection the operator console reads; the learner simply sees
    // only their own run.
    const mine = await asUser(learner.id, (client) =>
      client.query(
        `select workflow, instance_status, waiting_on, steps_total, steps_completed
         from public.workflow_instance_view
         where workflow = $1 and subject_profile_id = $2`,
        [COORDINATOR, learner.id],
      ),
    );
    expect(mine.rowCount).toBe(1);
    expect(Number(mine.rows[0].steps_total)).toBe(14);
    expect(mine.rows[0].waiting_on).toBe("waiting for learner_baseline_recorded");

    const stages = await asUser(learner.id, (client) =>
      client.query(
        `select step_key, work_item_status from public.my_workflow_state
         where instance_id = $1 order by step_ordinal`,
        [run!.id],
      ),
    );
    expect(stages.rows).toHaveLength(14);
    expect(stages.rows[0]).toMatchObject({ step_key: "signed_up", work_item_status: "completed" });

    const theirs = await asUser(stranger.id, (client) =>
      client.query(
        "select count(*)::int as n from public.workflow_instance_view where instance_id = $1",
        [run!.id],
      ),
    );
    expect(theirs.rows[0].n).toBe(0);
  });
});
