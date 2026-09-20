import { describe, expect, it } from "vitest";
import {
  asUser,
  assignProject,
  completeStepLearning,
  createUser,
  decideReview,
  expectRejection,
  generatePathwayOnce,
  grantPersonaOperator,
  makeReviewer,
  openReviewFor,
  pathwaySteps,
  proveCompetency,
  scoresFor,
  sql,
  submitEvidence,
  walkBaseline,
} from "./helpers";

async function learner(label: string) {
  const l = await createUser(label);
  await walkBaseline(l.id, { correctly: false });
  return l;
}

describe("projects", () => {
  it("assigns a brief and records it", async () => {
    const l = await learner("assignee");
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const [row] = await sql<{ status: string; competency_slug: string }>(
      `select p.status, c.slug as competency_slug from public.projects p
       join public.competencies c on c.id = p.competency_id where p.id = $1`,
      [projectId],
    );
    expect(row).toMatchObject({ status: "assigned", competency_slug: "ai-concepts" });
  });

  it("refuses a brief that does not build the step's competency", async () => {
    const l = await learner("mismatch");
    const pathwayId = await generatePathwayOnce(l.id);
    const steps = await pathwaySteps(l.id, pathwayId);
    const step = steps.find((s) => s.competency_slug === "ai-concepts")!;
    const rejection = await expectRejection(assignProject(l.id, "brief-ai-ethics", step.id));
    expect(rejection.message).toContain("does not build the competency");
  });

  it("refuses to attach a project to a locked step", async () => {
    const l = await learner("locked-project");
    const pathwayId = await generatePathwayOnce(l.id);
    const steps = await pathwaySteps(l.id, pathwayId);
    const locked = steps.find((s) => s.competency_slug === "applied-ai-projects")!;
    const rejection = await expectRejection(
      assignProject(l.id, "brief-applied-ai-projects", locked.id),
    );
    expect(rejection.message).toContain("still locked");
  });

  it("allows only one open project per brief", async () => {
    const l = await learner("dup-project");
    await assignProject(l.id, "brief-ai-concepts");
    const rejection = await expectRejection(assignProject(l.id, "brief-ai-concepts"));
    expect(rejection.code).toBe("23505");
  });
});

describe("evidence", () => {
  it("versions submissions and supersedes the previous one", async () => {
    const [l, r] = await Promise.all([learner("versioner"), makeReviewer("rev-versioner")]);
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const first = await submitEvidence(l.id, projectId);

    // A reviewer sends it back, then the learner resubmits.
    const reviewId = await openReviewFor(first);
    await asUser(r.id, (client) => client.query("select public.claim_review($1)", [reviewId]));
    await decideReview(r.id, reviewId, "revision_required", "Needs the test cases the brief asked for.");

    const second = await submitEvidence(l.id, projectId, "Second attempt with the three test cases and the outputs recorded.");

    const rows = await sql<{ version: number; status: string; superseded_by: string | null }>(
      "select version, status, superseded_by from public.evidence where project_id = $1 order by version",
      [projectId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ version: 1, status: "superseded", superseded_by: second });
    expect(rows[1]).toMatchObject({ version: 2, status: "submitted" });
  });

  it("refuses to rewrite submitted evidence", async () => {
    const l = await learner("immutable");
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const rejection = await expectRejection(
      sql("update public.evidence set summary = $2 where id = $1", [evidenceId, "rewritten summary that is long enough to pass the check constraint"]),
    );
    expect(rejection.message).toContain("evidence content is immutable");
  });

  it("requires a note when AI assistance is declared", async () => {
    const l = await learner("ai-declare");
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const rejection = await expectRejection(
      asUser(l.id, (client) =>
        client.query("select public.submit_evidence($1, $2, null, true, null)", [
          projectId,
          "A summary long enough to satisfy the forty character minimum requirement here.",
        ]),
      ),
    );
    expect(rejection.message).toContain("say how AI was used");
  });

  it("refuses a summary that says nothing", async () => {
    const l = await learner("thin");
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const rejection = await expectRejection(
      asUser(l.id, (client) =>
        client.query("select public.submit_evidence($1, $2)", [projectId, "done"]),
      ),
    );
    expect(rejection.message).toContain("at least 40 characters");
  });

  it("gives authenticated no direct write on evidence", async () => {
    const l = await learner("no-evidence-write");
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const rejection = await expectRejection(
      asUser(l.id, (client) =>
        client.query(
          `insert into public.evidence (project_id, profile_id, competency_id, rubric_id, version, summary)
           select $1, $2, competency_id, (select id from public.rubrics limit 1), 99,
                  'forged evidence that is long enough to pass the length constraint'
           from public.projects where id = $1`,
          [projectId, l.id],
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("opens exactly one review per submission", async () => {
    const l = await learner("one-review");
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const [{ count }] = await sql<{ count: string }>(
      "select count(*)::text from public.review_assignments where evidence_id = $1",
      [evidenceId],
    );
    expect(count).toBe("1");
  });
});

describe("verification is human and rubric-bound", () => {
  it("refuses review without the reviewer persona", async () => {
    const [l, other] = await Promise.all([learner("reviewee"), createUser("not-reviewer")]);
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const reviewId = await openReviewFor(evidenceId);

    const rejection = await expectRejection(
      asUser(other.id, (client) => client.query("select public.claim_review($1)", [reviewId])),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses self-review even with the reviewer persona", async () => {
    const l = await makeReviewer("self-reviewer");
    await walkBaseline(l.id, { correctly: false });
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const reviewId = await openReviewFor(evidenceId);

    const rejection = await expectRejection(
      asUser(l.id, (client) => client.query("select public.claim_review($1)", [reviewId])),
    );
    expect(rejection.message).toContain("cannot review your own evidence");
  });

  it("refuses a decision before the review is claimed", async () => {
    const [l, r] = await Promise.all([learner("unclaimed"), makeReviewer("rev-unclaimed")]);
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const reviewId = await openReviewFor(evidenceId);

    const rejection = await expectRejection(
      decideReview(r.id, reviewId, "approved", "Looks fine to me overall.", await scoresFor(evidenceId, 4)),
    );
    expect(rejection.message).toContain("claim this review");
  });

  it("refuses a decision with no rationale", async () => {
    const [l, r] = await Promise.all([learner("no-reason"), makeReviewer("rev-no-reason")]);
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const reviewId = await openReviewFor(evidenceId);
    await asUser(r.id, (client) => client.query("select public.claim_review($1)", [reviewId]));

    const rejection = await expectRejection(decideReview(r.id, reviewId, "approved", "ok"));
    expect(rejection.message).toContain("needs a rationale");
  });

  it("refuses approval when a required criterion is unscored", async () => {
    const [l, r] = await Promise.all([learner("partial-score"), makeReviewer("rev-partial")]);
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const reviewId = await openReviewFor(evidenceId);
    await asUser(r.id, (client) => client.query("select public.claim_review($1)", [reviewId]));

    const partial = (await scoresFor(evidenceId, 4)).slice(0, 1);
    const rejection = await expectRejection(
      decideReview(r.id, reviewId, "approved", "Scored one criterion only, which is not enough.", partial),
    );
    expect(rejection.message).toContain("score every required criterion");
  });

  it("refuses approval the rubric does not support", async () => {
    const [l, r] = await Promise.all([learner("failed-rubric"), makeReviewer("rev-failed")]);
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const reviewId = await openReviewFor(evidenceId);
    await asUser(r.id, (client) => client.query("select public.claim_review($1)", [reviewId]));

    const failing = await scoresFor(evidenceId, 2); // below the pass mark
    const rejection = await expectRejection(
      decideReview(r.id, reviewId, "approved", "I liked it despite the scores I recorded.", failing),
    );
    expect(rejection.message).toContain("does not support approval");
  });

  it("mints a fully traceable verified skill on approval", async () => {
    const [l, r] = await Promise.all([learner("verified"), makeReviewer("rev-verified")]);
    const { evidenceId, reviewId } = await proveCompetency(l.id, r.id, "brief-ai-concepts");

    const rows = await asUser(l.id, async (client) => {
      const result = await client.query(
        `select competency_slug, level, evidence_id, review_id, reviewer_name, reviewer_rationale,
                evidence_version, project_title
         from public.portfolio_view where profile_id = $1`,
        [l.id],
      );
      return result.rows as Array<Record<string, unknown>>;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      competency_slug: "ai-concepts",
      level: 3,
      evidence_id: evidenceId,
      review_id: reviewId,
      evidence_version: 1,
    });
    expect(rows[0].reviewer_name).toBe("rev-verified");
    expect(String(rows[0].reviewer_rationale).length).toBeGreaterThan(10);
  });

  it("refuses to rewrite a verified skill", async () => {
    const [l, r] = await Promise.all([learner("no-rewrite"), makeReviewer("rev-no-rewrite")]);
    await proveCompetency(l.id, r.id, "brief-ai-concepts");
    const [skill] = await sql<{ id: string }>(
      "select id from public.verified_skills where profile_id = $1",
      [l.id],
    );
    const rejection = await expectRejection(
      sql("update public.verified_skills set level = 5 where id = $1", [skill.id]),
    );
    expect(rejection.message).toContain("cannot be rewritten");
  });

  it("promotes the measured competency from reviewed evidence", async () => {
    const [l, r] = await Promise.all([learner("promoted"), makeReviewer("rev-promoted")]);
    const [before] = await sql<{ level: number; source: string }>(
      `select lc.level, lc.source from public.learner_competencies lc
       join public.competencies c on c.id = lc.competency_id
       where lc.profile_id = $1 and c.slug = 'ai-concepts'`,
      [l.id],
    );
    expect(before).toMatchObject({ level: 0, source: "baseline" });

    await proveCompetency(l.id, r.id, "brief-ai-concepts");

    const [after] = await sql<{ level: number; source: string; confidence: string }>(
      `select lc.level, lc.source, lc.confidence from public.learner_competencies lc
       join public.competencies c on c.id = lc.competency_id
       where lc.profile_id = $1 and c.slug = 'ai-concepts'`,
      [l.id],
    );
    expect(after.level).toBe(3);
    expect(after.source).toBe("evidence");
    expect(Number(after.confidence)).toBe(1);
  });

  it("completes the project and records the decision chain", async () => {
    const [l, r] = await Promise.all([learner("chain"), makeReviewer("rev-chain")]);
    const { projectId } = await proveCompetency(l.id, r.id, "brief-ai-concepts");

    const [project] = await sql<{ status: string }>(
      "select status from public.projects where id = $1",
      [projectId],
    );
    expect(project.status).toBe("completed");

    const actions = await sql<{ action: string }>(
      `select action from public.audit_events
       where action in ('evidence.evidence.submitted','verification.review.claimed','verification.skill.verified')
         and (actor_profile_id = $1 or actor_profile_id = $2) order by occurred_at`,
      [l.id, r.id],
    );
    expect(actions.map((a) => a.action)).toEqual([
      "evidence.evidence.submitted",
      "verification.review.claimed",
      "verification.skill.verified",
    ]);
  });

  it("rejection sends the project back for revision", async () => {
    const [l, r] = await Promise.all([learner("rejected"), makeReviewer("rev-rejected")]);
    const projectId = await assignProject(l.id, "brief-ai-concepts");
    const evidenceId = await submitEvidence(l.id, projectId);
    const reviewId = await openReviewFor(evidenceId);
    await asUser(r.id, (client) => client.query("select public.claim_review($1)", [reviewId]));
    await decideReview(r.id, reviewId, "rejected", "The artefact referenced is not reachable.");

    const [project] = await sql<{ status: string }>("select status from public.projects where id = $1", [projectId]);
    expect(project.status).toBe("revision_required");
    const [{ count }] = await sql<{ count: string }>(
      "select count(*)::text from public.verified_skills where profile_id = $1",
      [l.id],
    );
    expect(count).toBe("0");
  });

  it("keeps a learner from reading the is_correct-style internals of another's review", async () => {
    const [a, b, r] = await Promise.all([learner("rev-a"), createUser("rev-b"), makeReviewer("rev-r")]);
    await proveCompetency(a.id, r.id, "brief-ai-concepts");
    const seen = await asUser(b.id, async (client) => {
      const result = await client.query("select id from public.verified_skills where profile_id = $1", [a.id]);
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });
});

describe("credentials", () => {
  it("issues only when every required competency is verified", async () => {
    const [l, r] = await Promise.all([learner("credentialed"), makeReviewer("rev-cred")]);

    await proveCompetency(l.id, r.id, "brief-ai-concepts");
    let creds = await sql<{ slug: string }>(
      "select slug from public.credentials where profile_id = $1",
      [l.id],
    );
    expect(creds).toHaveLength(0); // one of two required skills

    await proveCompetency(l.id, r.id, "brief-ai-limitations");
    creds = await sql<{ slug: string }>("select slug from public.credentials where profile_id = $1", [l.id]);
    expect(creds.map((c) => c.slug)).toEqual(["ai-foundations-certificate"]);
  });

  it("records the issuance basis and the skills behind it", async () => {
    const [l, r] = await Promise.all([learner("basis"), makeReviewer("rev-basis")]);
    await proveCompetency(l.id, r.id, "brief-ai-concepts");
    await proveCompetency(l.id, r.id, "brief-ai-limitations");

    const [cred] = await sql<{
      id: string;
      criteria: { required_competencies: string[]; min_level: number };
      issuance_basis: { verified_skill_ids: string[] };
    }>("select id, criteria, issuance_basis from public.credentials where profile_id = $1", [l.id]);
    expect(cred.criteria.required_competencies.sort()).toEqual(["ai-concepts", "ai-limitations"]);
    expect(cred.criteria.min_level).toBe(3);
    expect(cred.issuance_basis.verified_skill_ids).toHaveLength(2);

    const links = await sql<{ verified_skill_id: string }>(
      "select verified_skill_id from public.credential_skills where credential_id = $1",
      [cred.id],
    );
    expect(links).toHaveLength(2);
  });

  it("is idempotent across further verifications", async () => {
    const [l, r] = await Promise.all([learner("idempotent-cred"), makeReviewer("rev-idem")]);
    await proveCompetency(l.id, r.id, "brief-ai-concepts");
    await proveCompetency(l.id, r.id, "brief-ai-limitations");
    await proveCompetency(l.id, r.id, "brief-ai-ethics");

    const [{ count }] = await sql<{ count: string }>(
      "select count(*)::text from public.credentials where profile_id = $1 and slug = 'ai-foundations-certificate'",
      [l.id],
    );
    expect(count).toBe("1");
  });

  it("only an operator may revoke, and revocation needs a reason", async () => {
    const [l, r, op] = await Promise.all([
      learner("revokee"),
      makeReviewer("rev-revoke"),
      createUser("operator-revoke"),
    ]);
    await proveCompetency(l.id, r.id, "brief-ai-concepts");
    await proveCompetency(l.id, r.id, "brief-ai-limitations");
    const [cred] = await sql<{ id: string }>(
      "select id from public.credentials where profile_id = $1",
      [l.id],
    );

    const denied = await expectRejection(
      asUser(l.id, (client) => client.query("select public.revoke_credential($1, $2)", [cred.id, "I would rather not have it"])),
    );
    expect(denied.code).toBe("42501");

    await grantPersonaOperator(op.id);
    const noReason = await expectRejection(
      asUser(op.id, (client) => client.query("select public.revoke_credential($1, $2)", [cred.id, "bad"])),
    );
    expect(noReason.message).toContain("needs a reason");

    await asUser(op.id, (client) =>
      client.query("select public.revoke_credential($1, $2)", [cred.id, "Evidence was found to be plagiarised."]),
    );
    const [after] = await sql<{ status: string; revocation_reason: string }>(
      "select status, revocation_reason from public.credentials where id = $1",
      [cred.id],
    );
    expect(after.status).toBe("revoked");
    expect(after.revocation_reason).toContain("plagiarised");
  });
});

describe("pathway step completion now needs verified evidence", () => {
  it("learning alone no longer closes a step whose competency demands evidence", async () => {
    const l = await learner("needs-evidence");
    const pathwayId = await generatePathwayOnce(l.id);
    const steps = await pathwaySteps(l.id, pathwayId);
    const step = steps.find((s) => s.competency_slug === "ai-concepts")!;

    await completeStepLearning(l.id, step.id);

    const after = await pathwaySteps(l.id, pathwayId);
    expect(after.find((s) => s.id === step.id)!.status).toBe("in_progress");
  });

  it("closes once the evidence for that competency is verified", async () => {
    const [l, r] = await Promise.all([learner("closes"), makeReviewer("rev-closes")]);
    const pathwayId = await generatePathwayOnce(l.id);
    const steps = await pathwaySteps(l.id, pathwayId);
    const step = steps.find((s) => s.competency_slug === "ai-concepts")!;

    await completeStepLearning(l.id, step.id);
    await proveCompetency(l.id, r.id, "brief-ai-concepts", step.id);

    const after = await pathwaySteps(l.id, pathwayId);
    expect(after.find((s) => s.id === step.id)!.status).toBe("completed");
    // And the dependent step unlocks.
    expect(after.find((s) => s.competency_slug === "prompt-design")!.status).toBe("available");
  });
});
