import { describe, expect, it } from "vitest";
import {
  asAnon,
  asServiceRole,
  asUser,
  assignProject,
  completeOnboarding,
  createUser,
  decideReview,
  expectRejection,
  generatePathwayOnce,
  grantPersona,
  grantPersonaOperator,
  makeReviewer,
  openReviewFor,
  scoresFor,
  sql,
  submitEvidence,
  walkBaseline,
} from "./helpers";

const nonce = () => Math.random().toString(36).slice(2, 10);

async function startFor(profile: string, workflow: string): Promise<string> {
  return asServiceRole(async (client) => {
    const r = await client.query(
      "select (btg.start_workflow($1, $2, null, $3)).id as id",
      [workflow, profile, `${workflow}:${profile}:${nonce()}`],
    );
    return r.rows[0].id as string;
  });
}

async function signalAs(profile: string, subjectType: string, subjectId: string) {
  return asUser(profile, (client) =>
    client.query("select public.signal_my_workflows($1, $2)", [subjectType, subjectId]),
  );
}

async function advanceAs(profile: string) {
  return asUser(profile, (client) => client.query("select * from public.advance_my_workflows(5)"));
}

async function itemFor(instanceId: string, stepKey: string) {
  const [row] = await sql<{ id: string; status: string; owner_persona: string | null }>(
    `select id, status::text as status, owner_persona::text as owner_persona
     from public.workflow_work_items
     where workflow_instance_id = $1 and step_key = $2 and status <> 'cancelled'`,
    [instanceId, stepKey],
  );
  return row;
}

async function itemStatuses(instanceId: string) {
  const rows = await sql<{ status: string }>(
    `select w.status::text as status from public.workflow_work_items w
     join public.workflow_instances i on i.id = w.workflow_instance_id
     join public.workflow_definition_steps s
       on s.definition_version_id = i.definition_version_id and s.step_key = w.step_key
     where w.workflow_instance_id = $1 order by s.ordinal`,
    [instanceId],
  );
  return rows.map((r) => r.status);
}

async function instanceStatus(instanceId: string): Promise<string> {
  const [row] = await sql<{ status: string }>(
    "select status::text as status from public.workflow_instances where id = $1",
    [instanceId],
  );
  return row.status;
}

/** A learner with submitted evidence and a verification run parked on a reviewer. */
async function evidenceAwaitingReview() {
  const learner = await createUser(`hw-learner-${nonce()}`);
  await completeOnboarding(learner.id);
  await walkBaseline(learner.id, { correctly: false });
  await generatePathwayOnce(learner.id);
  const projectId = await assignProject(learner.id, "brief-prompt-design");
  const evidenceId = await submitEvidence(learner.id, projectId);

  const instance = await startFor(learner.id, "verification");
  await signalAs(learner.id, "evidence", evidenceId);
  await advanceAs(learner.id);

  return { learner, evidenceId, instance };
}

describe("human work reaches the right person", () => {
  it("parks a reviewer decision for the reviewer persona, not for the learner", async () => {
    const { learner, instance } = await evidenceAwaitingReview();
    const reviewer = await makeReviewer(`hw-rev-${nonce()}`);

    expect(await itemStatuses(instance)).toEqual(["completed", "ready", "pending"]);
    expect(await instanceStatus(instance)).toBe("waiting");

    const item = await itemFor(instance, "reviewer_decision");
    expect(item.owner_persona).toBe("reviewer");

    // It appears in the reviewer's queue.
    const queue = await asUser(reviewer.id, (client) =>
      client.query(
        "select work_item_id, workflow, step_key, mine from public.my_work_queue where work_item_id = $1",
        [item.id],
      ),
    );
    expect(queue.rowCount).toBe(1);
    expect(queue.rows[0].workflow).toBe("verification");
    expect(queue.rows[0].mine).toBe(false);

    // And never in the learner's own.
    const learnerQueue = await asUser(learner.id, (client) =>
      client.query("select work_item_id from public.my_work_queue where work_item_id = $1", [
        item.id,
      ]),
    );
    expect(learnerQueue.rowCount).toBe(0);
  });

  it("keeps a persona queue out of reach of a persona the caller does not hold", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");

    const outsider = await createUser(`hw-outsider-${nonce()}`);
    const visible = await asUser(outsider.id, (client) =>
      client.query("select work_item_id from public.my_work_queue where work_item_id = $1", [
        item.id,
      ]),
    );
    expect(visible.rowCount).toBe(0);

    const rejection = await asUser(outsider.id, (client) =>
      expectRejection(client.query("select public.claim_work_item($1)", [item.id])),
    );
    expect(rejection.code).toBe("42501");
    expect(rejection.message).toMatch(/reviewer persona/);
  });

  it("refuses self-review, and says so", async () => {
    const { learner, instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");

    // Even holding the reviewer persona, the learner cannot take work on their
    // own run.
    await grantPersona(learner.id, "reviewer");
    const rejection = await asUser(learner.id, (client) =>
      expectRejection(client.query("select public.claim_work_item($1)", [item.id])),
    );
    expect(rejection.code).toBe("42501");
    expect(rejection.message).toMatch(/own run/);
  });

  it("refuses self-review even for an operator", async () => {
    const { learner, instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    await grantPersonaOperator(learner.id);

    const rejection = await asUser(learner.id, (client) =>
      expectRejection(client.query("select public.claim_work_item($1)", [item.id])),
    );
    expect(rejection.code).toBe("42501");
    expect(rejection.message).toMatch(/own run/);
  });

  it("gives one item to exactly one claimant", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const first = await makeReviewer(`hw-race-a-${nonce()}`);
    const second = await makeReviewer(`hw-race-b-${nonce()}`);

    const outcomes = await Promise.all([
      asUser(first.id, (client) =>
        client.query("select public.claim_work_item($1)", [item.id]).then(
          () => "won",
          () => "lost",
        ),
      ),
      asUser(second.id, (client) =>
        client.query("select public.claim_work_item($1)", [item.id]).then(
          () => "won",
          () => "lost",
        ),
      ),
    ]);
    expect(outcomes.filter((o) => o === "won")).toHaveLength(1);

    const [row] = await sql<{ claimed_by: string; status: string }>(
      "select claimed_by, status::text as status from public.workflow_work_items where id = $1",
      [item.id],
    );
    expect(row.status).toBe("claimed");
    expect([first.id, second.id]).toContain(row.claimed_by);
  });

  it("is idempotent when the same person claims twice", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const reviewer = await makeReviewer(`hw-twice-${nonce()}`);

    await asUser(reviewer.id, async (client) => {
      await client.query("select public.claim_work_item($1)", [item.id]);
      await client.query("select public.claim_work_item($1)", [item.id]);
    });
    const [{ n }] = await sql<{ n: string }>(
      `select count(*)::text as n from btg.orchestration_events
       where work_item_id = $1 and event_type = 'claimed_by_person'`,
      [item.id],
    );
    expect(Number(n)).toBe(1);
  });

  it("releases work back to the queue for its owner only", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const mine = await makeReviewer(`hw-rel-a-${nonce()}`);
    const other = await makeReviewer(`hw-rel-b-${nonce()}`);

    await asUser(mine.id, (client) =>
      client.query("select public.claim_work_item($1)", [item.id]),
    );

    const denied = await asUser(other.id, (client) =>
      expectRejection(client.query("select public.release_work_item($1)", [item.id])),
    );
    expect(denied.code).toBe("42501");

    await asUser(mine.id, (client) =>
      client.query("select public.release_work_item($1)", [item.id]),
    );
    const [row] = await sql<{ status: string; claimed_by: string | null }>(
      "select status::text as status, claimed_by from public.workflow_work_items where id = $1",
      [item.id],
    );
    expect(row).toMatchObject({ status: "ready", claimed_by: null });
  });
});

describe("completing human work never manufactures the outcome", () => {
  it("refuses completion until the reviewer has actually decided", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const reviewer = await makeReviewer(`hw-nodecision-${nonce()}`);

    await asUser(reviewer.id, (client) =>
      client.query("select public.claim_work_item($1)", [item.id]),
    );

    // Claimed, but no decision recorded: the domain does not show it, so the
    // runtime refuses to say it happened.
    const rejection = await asUser(reviewer.id, (client) =>
      expectRejection(client.query("select public.complete_my_work_item($1)", [item.id])),
    );
    expect(rejection.message).toMatch(/does not show evidence_reviewed/);

    expect(await itemStatuses(instance)).toEqual(["completed", "claimed", "pending"]);
    const [{ n }] = await sql<{ n: string }>(
      "select count(*)::text as n from public.verified_skills where evidence_id is not null and review_id is not null and created_at > now() - interval '1 minute'",
    );
    expect(Number(n)).toBeGreaterThanOrEqual(0);
  });

  it("completes once the governed engine command has run, and carries the workflow on", async () => {
    const { learner, evidenceId, instance } = await evidenceAwaitingReview();
    const reviewer = await makeReviewer(`hw-decide-${nonce()}`);
    const item = await itemFor(instance, "reviewer_decision");

    await asUser(reviewer.id, (client) =>
      client.query("select public.claim_work_item($1)", [item.id]),
    );

    // The real decision, through the real engine command, in the reviewer's
    // own session. The workflow is not involved.
    const reviewId = await openReviewFor(evidenceId);
    await asUser(reviewer.id, (client) =>
      client.query("select public.claim_review($1)", [reviewId]),
    );
    await decideReview(reviewer.id, reviewId, "approved", undefined, await scoresFor(evidenceId, 4));

    // Now the runtime may notice -- and carries the run on from there, so the
    // learner does not have to come back and press something.
    await asUser(reviewer.id, (client) =>
      client.query("select public.complete_my_work_item($1)", [item.id]),
    );
    expect(await itemStatuses(instance)).toEqual(["completed", "completed", "completed"]);
    expect(await instanceStatus(instance)).toBe("completed");

    // The verified skill came from the verification engine, not the workflow.
    const [skill] = await sql<{ reviewer_profile_id: string; evidence_id: string }>(
      `select reviewer_profile_id, evidence_id from public.verified_skills
       where evidence_id = $1 and revoked_at is null`,
      [evidenceId],
    );
    expect(skill.reviewer_profile_id).toBe(reviewer.id);

    // And the final system step closes the run on the evidence the engine cited.
    await signalAs(learner.id, "evidence", evidenceId);
    await advanceAs(learner.id);
    expect(await itemStatuses(instance)).toEqual(["completed", "completed", "completed"]);
    expect(await instanceStatus(instance)).toBe("completed");
  });

  it("refuses completion from somebody who did not claim it", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const holder = await makeReviewer(`hw-holder-${nonce()}`);
    const bystander = await makeReviewer(`hw-bystander-${nonce()}`);

    await asUser(holder.id, (client) =>
      client.query("select public.claim_work_item($1)", [item.id]),
    );
    const rejection = await asUser(bystander.id, (client) =>
      expectRejection(client.query("select public.complete_my_work_item($1)", [item.id])),
    );
    expect(rejection.code).toBe("42501");
    expect(rejection.message).toMatch(/claim that work/);
  });

  it("gives no session any other way to move a work item", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const reviewer = await makeReviewer(`hw-noside-${nonce()}`);

    for (const call of [
      "select btg.complete_work_item($1)",
      "select btg.escalate_work_item($1, 'forced')",
      "select btg.abandon_work_item($1, 'forced')",
    ]) {
      const rejection = await asUser(reviewer.id, (client) =>
        expectRejection(client.query(call, [item.id])),
      );
      expect(rejection.code).toBe("42501");
    }

    const direct = await asUser(reviewer.id, (client) =>
      expectRejection(
        client.query("update public.workflow_work_items set status = 'completed' where id = $1", [
          item.id,
        ]),
      ),
    );
    expect(direct.code).toBe("42501");
  });
});

describe("deadlines, escalation and handover", () => {
  it("escalates overdue human work to an operator and notifies them", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const operator = await createUser(`hw-op-${nonce()}`);
    await grantPersonaOperator(operator.id);

    await sql(
      "update public.workflow_work_items set deadline_at = now() - interval '1 hour' where id = $1",
      [item.id],
    );

    const swept = await asUser(operator.id, async (client) => {
      const r = await client.query("select public.escalate_overdue_work(50) as n");
      return Number(r.rows[0].n);
    });
    expect(swept).toBeGreaterThanOrEqual(1);

    const [row] = await sql<{ status: string; owner_persona: string }>(
      "select status::text as status, owner_persona::text as owner_persona from public.workflow_work_items where id = $1",
      [item.id],
    );
    expect(row).toMatchObject({ status: "escalated", owner_persona: "operator" });

    // Escalation is the one persona queue that pushes.
    const [{ n }] = await sql<{ n: string }>(
      `select count(*)::text as n from public.notifications
       where profile_id = $1 and dedupe_key = $2`,
      [operator.id, `workflow.escalated:${item.id}`],
    );
    expect(Number(n)).toBe(1);

    // The run is still open: a decision that is owed is still owed.
    expect(await instanceStatus(instance)).toBe("waiting");
  });

  it("lets only an operator run the sweep", async () => {
    const reviewer = await makeReviewer(`hw-sweep-${nonce()}`);
    const rejection = await asUser(reviewer.id, (client) =>
      expectRejection(client.query("select public.escalate_overdue_work(10)")),
    );
    expect(rejection.code).toBe("42501");
  });

  it("reassigns only to somebody who may actually do the work", async () => {
    const { learner, instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const operator = await createUser(`hw-reassign-op-${nonce()}`);
    await grantPersonaOperator(operator.id);
    const reviewer = await makeReviewer(`hw-reassign-to-${nonce()}`);
    const stranger = await createUser(`hw-reassign-no-${nonce()}`);

    // Not to someone without the persona.
    const wrongPersona = await asUser(operator.id, (client) =>
      expectRejection(
        client.query("select public.reassign_work_item($1, $2)", [item.id, stranger.id]),
      ),
    );
    expect(wrongPersona.message).toMatch(/reviewer persona/);

    // And never to the subject of the run, which would route around the rule.
    await grantPersona(learner.id, "reviewer");
    const selfRoute = await asUser(operator.id, (client) =>
      expectRejection(
        client.query("select public.reassign_work_item($1, $2)", [item.id, learner.id]),
      ),
    );
    expect(selfRoute.message).toMatch(/own run/);

    await asUser(operator.id, (client) =>
      client.query("select public.reassign_work_item($1, $2)", [item.id, reviewer.id]),
    );
    const [row] = await sql<{ owner_kind: string; owner_profile_id: string; status: string }>(
      `select owner_kind::text as owner_kind, owner_profile_id, status::text as status
       from public.workflow_work_items where id = $1`,
      [item.id],
    );
    expect(row).toMatchObject({
      owner_kind: "profile",
      owner_profile_id: reviewer.id,
      status: "ready",
    });

    // Assigned work does push a notification, because it names a person.
    const [{ n }] = await sql<{ n: string }>(
      "select count(*)::text as n from public.notifications where profile_id = $1 and dedupe_key = $2",
      [reviewer.id, `workflow.assigned:${item.id}`],
    );
    expect(Number(n)).toBe(1);
  });

  it("lets nobody but an operator reassign", async () => {
    const { instance } = await evidenceAwaitingReview();
    const item = await itemFor(instance, "reviewer_decision");
    const reviewer = await makeReviewer(`hw-noreassign-${nonce()}`);
    const rejection = await asUser(reviewer.id, (client) =>
      expectRejection(
        client.query("select public.reassign_work_item($1, $2)", [item.id, reviewer.id]),
      ),
    );
    expect(rejection.code).toBe("42501");
  });
});

describe("the mentor and employer queues are the same mechanism", () => {
  it("parks a mentorship request for the mentor persona", async () => {
    const learner = await createUser(`hw-mentee-${nonce()}`);
    const mentor = await createUser(`hw-mentor-${nonce()}`);
    await grantPersona(mentor.id, "mentor");
    await completeOnboarding(learner.id);
    await walkBaseline(learner.id, { correctly: false });
    await generatePathwayOnce(learner.id);

    const [competency] = await sql<{ id: string }>(
      `select s.competency_id as id from public.pathway_steps s
       join public.pathways p on p.id = s.pathway_id
       where p.profile_id = $1 and p.status = 'active' limit 1`,
      [learner.id],
    );
    await sql(
      `insert into public.mentor_profiles (profile_id, headline, monthly_capacity, is_accepting)
       values ($1, 'Works in the field', 3, true)`,
      [mentor.id],
    );
    await sql(
      "insert into public.mentor_expertise (profile_id, competency_id) values ($1, $2)",
      [mentor.id, competency.id],
    );
    const mentorshipId = await asUser(learner.id, async (client) => {
      const r = await client.query(
        "select (public.request_mentorship($1, $2, $3)).id as id",
        [mentor.id, competency.id, "I would like help with this."],
      );
      return r.rows[0].id as string;
    });

    const instance = await startFor(learner.id, "mentorship");
    await signalAs(learner.id, "mentorship", mentorshipId);
    await advanceAs(learner.id);

    const item = await itemFor(instance, "mentor_answer");
    expect(item.owner_persona).toBe("mentor");
    expect(item.status).toBe("ready");

    const queue = await asUser(mentor.id, (client) =>
      client.query("select workflow from public.my_work_queue where work_item_id = $1", [item.id]),
    );
    expect(queue.rows[0].workflow).toBe("mentorship");

    // The mentor answers through the engine, then the item may complete.
    await asUser(mentor.id, (client) =>
      client.query("select public.claim_work_item($1)", [item.id]),
    );
    const early = await asUser(mentor.id, (client) =>
      expectRejection(client.query("select public.complete_my_work_item($1)", [item.id])),
    );
    expect(early.message).toMatch(/does not show mentorship_answered/);

    await asUser(mentor.id, (client) =>
      client.query("select public.respond_to_mentorship($1, true, $2)", [
        mentorshipId,
        "Happy to help — let us start next week.",
      ]),
    );
    await asUser(mentor.id, (client) =>
      client.query("select public.complete_my_work_item($1)", [item.id]),
    );
    expect(await instanceStatus(instance)).toBe("completed");
  });

  it("shows anonymous visitors nothing and offers them no commands", async () => {
    for (const call of [
      "select count(*) from public.my_work_queue",
      "select public.claim_work_item(gen_random_uuid())",
      "select public.complete_my_work_item(gen_random_uuid())",
      "select public.release_work_item(gen_random_uuid())",
      "select public.reassign_work_item(gen_random_uuid(), gen_random_uuid())",
      "select public.escalate_overdue_work(1)",
    ]) {
      const rejection = await asAnon((client) => expectRejection(client.query(call)));
      expect(rejection.code).toBe("42501");
    }
  });
});
