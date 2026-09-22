import { describe, expect, it } from "vitest";
import { createUser, grantPersona, pool, sql, expectRejection } from "./helpers";

describe("canonical capstones reuse governed evidence", () => {
  it("maps every capstone competency to a draft brief and rubric, including VC12 deployment", async () => {
    const [row] = await sql(`select
      (select count(distinct activity_id)::int from curriculum_project_briefs) projects,
      (select count(*)::int from btg.curriculum_manifests m cross join lateral jsonb_array_elements(m.document->'projects') p
       cross join lateral jsonb_array_elements(p->'competency_checks') k where m.version=1) expected_checks,
      (select count(*)::int from curriculum_project_briefs) actual_checks,
      (select count(*)::int from curriculum_project_briefs b join project_briefs p on p.id=b.brief_id where p.status<>'draft') published,
      (select count(*)::int from curriculum_project_briefs b join curriculum_lessons l using(activity_id)
        join rubrics r on r.brief_id=b.brief_id where l.lesson_code='VC12' and not exists(
          select 1 from rubric_criteria c where c.rubric_id=r.id and c.code='deployment' and c.is_required)) missing_deployment`);
    expect(row.projects).toBe(11);
    expect(row.actual_checks).toBe(row.expected_checks);
    expect(row.published).toBe(0);
    expect(row.missing_deployment).toBe(0);
  });

  it("routes VC12 evidence through revision, independent review, competency and portfolio", async () => {
    const learner = await createUser("vc12-project-learner");
    const reviewer = await createUser("vc12-project-reviewer");
    await grantPersona(learner.id, "learner");
    await grantPersona(learner.id, "reviewer"); // Even a learner with reviewer authority cannot self-review.
    await grantPersona(reviewer.id, "reviewer");
    const c = await pool.connect();
    try {
      await c.query("begin");
      // Rollback-only fixture isolates this bridge from prerequisites/video certification.
      await c.query("update profiles set baseline_completed_at=now() where id=$1", [learner.id]);
      const lesson = (await c.query("update curriculum_lessons set contract=jsonb_set(contract,'{prerequisites}','[]'),status='published',published_at=now() where lesson_code='VC12' returning activity_id")).rows[0];
      const brief = (await c.query("select p.slug,p.competency_id from curriculum_project_briefs b join project_briefs p on p.id=b.brief_id where b.activity_id=$1 order by p.slug limit 1", [lesson.activity_id])).rows[0];
      const become = async (id: string) => {
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
        await c.query("set local role authenticated");
      };
      await become(learner.id);
      await c.query("select start_curriculum_attempt($1)", [lesson.activity_id]);
      // FROM ensures this mutating composite function executes once.
      const project = (await c.query("select p.* from assign_project($1) p", [brief.slug])).rows[0];
      const submit = async (summary: string) => (await c.query("select e.* from submit_evidence($1,$2) e", [project.id, summary])).rows[0];
      const first = await submit("Initial capstone evidence requiring actual deployment and reproducible verification.");
      expect((await c.query("select * from verified_skills where profile_id=$1", [learner.id])).rows).toHaveLength(0);
      const review = (await c.query("select id from review_assignments where evidence_id=$1", [first.id])).rows[0];
      await c.query("savepoint self_review");
      expect((await expectRejection(c.query("select claim_review($1)", [review.id]))).message).toMatch(/own|self/i);
      await c.query("rollback to savepoint self_review");
      await become(reviewer.id);
      await c.query("select claim_review($1)", [review.id]);
      await c.query("select decide_review($1,'revision_required',$2,'[]')", [review.id, "Supply actual deployment observations and executed end-to-end checks."]);
      await become(learner.id);
      const second = await submit("Revised capstone evidence with deployment observations and recorded end-to-end checks for reviewer inspection.");
      const nextReview = (await c.query("select id from review_assignments where evidence_id=$1", [second.id])).rows[0];
      await become(reviewer.id);
      await c.query("select claim_review($1)", [nextReview.id]);
      const scores = (await c.query("select id as criterion_id,4 as score from rubric_criteria where rubric_id=$1", [second.rubric_id])).rows;
      await c.query("select decide_review($1,'approved',$2,$3::jsonb)", [nextReview.id, "Test reviewer decision: every required criterion is satisfied in this isolated fixture.", JSON.stringify(scores)]);
      await become(learner.id);
      expect((await c.query("select version,status from evidence where project_id=$1 order by version", [project.id])).rows).toEqual([{version:1,status:"superseded"},{version:2,status:"accepted"}]);
      expect((await c.query("select level,source from learner_competencies where profile_id=$1 and competency_id=$2", [learner.id,brief.competency_id])).rows[0]).toMatchObject({level:3,source:"evidence"});
      expect((await c.query("select * from portfolio_view where profile_id=$1", [learner.id])).rows).toHaveLength(1);
      expect((await c.query("select curriculum_progress($1) p", [lesson.activity_id])).rows[0].p.completed).toBe(false);
    } finally { await c.query("rollback"); c.release(); }
  });
});
