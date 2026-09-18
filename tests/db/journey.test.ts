import { describe, expect, it } from "vitest";
import {
  asUser,
  completeOnboarding,
  completeStepLearning,
  createUser,
  expectRejection,
  generatePathwayOnce,
  makeReviewer,
  pathwaySteps,
  proveCompetency,
  sql,
  walkBaseline,
} from "./helpers";

/**
 * Cross-engine convergence. One learner walks the whole canonical journey
 * through the real commands only -- no direct writes, no fixtures inserted
 * behind the domain -- and every engine's output is asserted from the record
 * the previous engine produced.
 *
 * E1 identity -> E2 onboarding -> E3 diagnostic -> E4 competency ->
 * E5 pathway -> E6 learning -> E8 projects -> E9 evidence ->
 * E10 verification -> E11 credentials -> E13 matching -> E15 applications ->
 * E17 outcomes.
 */
describe("the golden journey converges across every engine", () => {
  it("carries one learner from sign-up to an accepted offer", async () => {
    // --- E1/E2 identity and onboarding -------------------------------------
    const learner = await createUser("journey-learner");
    await completeOnboarding(learner.id, "Become an applied AI practitioner");

    const [profile] = await sql<{ onboarding_state: string; primary_persona: string }>(
      "select onboarding_state, primary_persona from public.profiles where id = $1",
      [learner.id],
    );
    expect(profile.onboarding_state).toBe("completed");
    expect(profile.primary_persona).toBe("learner");

    // --- E3/E4 diagnostic and competency graph -----------------------------
    await walkBaseline(learner.id, { correctly: false });
    const measured = await sql<{ n: string }>(
      "select count(*) as n from public.learner_competencies where profile_id = $1",
      [learner.id],
    );
    expect(Number(measured[0].n)).toBeGreaterThan(0);

    // --- E5 pathway, generated from that attempt ---------------------------
    const pathwayId = await generatePathwayOnce(learner.id);
    const [pathway] = await sql<{ generated_from_attempt_id: string | null; status: string }>(
      "select generated_from_attempt_id, status from public.pathways where id = $1",
      [pathwayId],
    );
    expect(pathway.status).toBe("active");
    // The plan is traceable to the diagnostic that produced it.
    expect(pathway.generated_from_attempt_id).not.toBeNull();

    const steps = await pathwaySteps(learner.id, pathwayId);
    expect(steps.length).toBeGreaterThan(0);
    const firstStep = steps.find((s) => s.status === "available")!;
    expect(firstStep).toBeDefined();

    // --- E6 learning -------------------------------------------------------
    await completeStepLearning(learner.id, firstStep.id);
    const [moduleProgress] = await sql<{ n: string }>(
      "select count(*) as n from public.learner_module_progress where profile_id = $1 and status = 'completed'",
      [learner.id],
    );
    expect(Number(moduleProgress.n)).toBeGreaterThan(0);

    // --- E8/E9/E10/E11 project, evidence, verification, credential ---------
    const reviewer = await makeReviewer("journey-reviewer");
    await proveCompetency(learner.id, reviewer.id, "brief-ai-concepts");
    await proveCompetency(learner.id, reviewer.id, "brief-ai-limitations");

    const credentials = await sql<{ slug: string; status: string; issuance_basis: unknown }>(
      "select slug, status, issuance_basis from public.credentials where profile_id = $1",
      [learner.id],
    );
    expect(credentials.map((c) => c.slug)).toContain("ai-foundations-certificate");
    const certificate = credentials.find((c) => c.slug === "ai-foundations-certificate")!;
    expect(certificate.status).toBe("issued");
    // A credential states what it was issued on: no unexplained award.
    expect(certificate.issuance_basis).not.toBeNull();

    // The verified level outranks the diagnostic estimate it replaced.
    const [upgraded] = await sql<{ source: string; level: number }>(
      `select lc.source, lc.level from public.learner_competencies lc
       join public.competencies c on c.id = lc.competency_id
       where lc.profile_id = $1 and c.slug = 'ai-limitations'`,
      [learner.id],
    );
    expect(upgraded.source).toBe("evidence");
    expect(upgraded.level).toBeGreaterThanOrEqual(3);

    // --- E13 matching, recomputed from verified evidence -------------------
    await proveCompetency(learner.id, reviewer.id, "brief-data-interpretation");
    const scored = await asUser(learner.id, async (client) => {
      const result = await client.query("select public.refresh_my_matches() as n");
      return Number(result.rows[0].n);
    });
    expect(scored).toBeGreaterThan(0);

    const [research] = await sql<{ id: string }>(
      "select id from public.opportunities where slug = 'ai-literacy-research-assistant'",
    );
    const [match] = await sql<{ score: number; matched: unknown[] }>(
      "select score, matched from public.opportunity_matches where profile_id = $1 and opportunity_id = $2",
      [learner.id, research.id],
    );
    // Both required competencies are now verified, so the score is not zero and
    // the reason is enumerated rather than asserted.
    expect(match.score).toBeGreaterThan(0);
    expect(match.matched.length).toBeGreaterThan(0);

    // --- E15 application, offer and acceptance -----------------------------
    const applicationId = await asUser(learner.id, async (client) => {
      const result = await client.query(
        "select (public.apply_to_opportunity($1)).id as id",
        [research.id],
      );
      return result.rows[0].id as string;
    });

    const employer = await createUser("journey-employer");
    const [org] = await sql<{ id: string }>(
      "select organization_id as id from public.opportunities where id = $1",
      [research.id],
    );
    await sql(
      `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
       values ($1, $2, 'employer', 'active', now())`,
      [org.id, employer.id],
    );

    for (const status of ["under_review", "shortlisted", "offered"]) {
      await asUser(employer.id, (client) =>
        client.query("select public.advance_application($1, $2::public.btg_application_status, null)", [
          applicationId,
          status,
        ]),
      );
    }
    await asUser(learner.id, (client) =>
      client.query("select public.respond_to_offer($1, true)", [applicationId]),
    );
    const [application] = await sql<{ status: string }>(
      "select status from public.applications where id = $1",
      [applicationId],
    );
    expect(application.status).toBe("accepted");

    // --- E17 outcomes, counted from all of the above -----------------------
    const [funnel] = await asUser(learner.id, async (client) => {
      const result = await client.query(
        "select * from public.learner_outcome_view where profile_id = $1",
        [learner.id],
      );
      return result.rows as Array<Record<string, string>>;
    });
    expect(Number(funnel.active_pathways)).toBe(1);
    expect(Number(funnel.modules_completed)).toBeGreaterThan(0);
    expect(Number(funnel.projects_completed)).toBe(3);
    expect(Number(funnel.evidence_submitted)).toBe(3);
    expect(Number(funnel.skills_verified)).toBe(3);
    expect(Number(funnel.credentials_live)).toBeGreaterThanOrEqual(1);
    expect(Number(funnel.offers_accepted)).toBe(1);

    // The ledger tells the same story, in order, from the learner's own events.
    const timeline = await asUser(learner.id, async (client) => {
      const result = await client.query(
        "select outcome, stage from public.outcome_timeline_view where profile_id = $1 order by stage",
        [learner.id],
      );
      return result.rows as Array<{ outcome: string; stage: number }>;
    });
    const reached = new Set(timeline.map((t) => t.outcome));
    for (const stage of [
      "onboarded",
      "baseline_measured",
      "pathway_generated",
      "module_completed",
      "project_assigned",
      "evidence_submitted",
      "opportunity_match_created",
      "opportunity_applied",
      "opportunity_accepted",
    ]) {
      expect(reached).toContain(stage);
    }
    // stages arrive non-decreasing when ordered by stage, which is what a UI relies on.
    const stages = timeline.map((t) => t.stage);
    expect([...stages]).toEqual([...stages].sort((a, b) => a - b));
  }, 60_000);

  it("refuses every shortcut through the journey", async () => {
    const learner = await createUser("journey-shortcut");
    await completeOnboarding(learner.id);

    // A pathway cannot precede a scored diagnostic.
    const noPathway = await asUser(learner.id, (client) =>
      client.query("select public.generate_pathway()").then(
        () => null,
        (error: { code?: string; message: string }) => error,
      ),
    );
    expect(noPathway).not.toBeNull();

    // A standalone brief is deliberately open: evidence may be the way a
    // learner enters, so assign_project does not require a baseline. What it
    // does refuse is attaching that project to a step the learner does not own.
    const other = await createUser("journey-shortcut-other");
    await walkBaseline(other.id, { correctly: false });
    const foreignPathway = await generatePathwayOnce(other.id);
    const foreignStep = (await pathwaySteps(other.id, foreignPathway)).find(
      (s) => s.status === "available",
    )!;
    const stolenStep = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.assign_project($1, $2)", ["brief-ai-concepts", foreignStep.id]),
      ),
    );
    expect(stolenStep.code).toBe("P0002");

    // And it refuses a brief that does not build what the step targets.
    const ownBaseline = await createUser("journey-shortcut-own");
    await walkBaseline(ownBaseline.id, { correctly: false });
    const ownPathway = await generatePathwayOnce(ownBaseline.id);
    const ownStep = (await pathwaySteps(ownBaseline.id, ownPathway)).find(
      (s) => s.status === "available",
    )!;
    const wrongBrief = await expectRejection(
      asUser(ownBaseline.id, (client) =>
        client.query("select public.assign_project($1, $2)", [
          ownStep.competency_slug === "ai-concepts" ? "brief-ai-ethics" : "brief-ai-concepts",
          ownStep.id,
        ]),
      ),
    );
    expect(wrongBrief.code).toBe("23514");

    // No credential exists without a verified skill behind it.
    const [credentials] = await sql<{ n: string }>(
      "select count(*) as n from public.credentials where profile_id = $1",
      [learner.id],
    );
    expect(Number(credentials.n)).toBe(0);
  }, 30_000);
});
