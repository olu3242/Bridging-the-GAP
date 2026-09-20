import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asUser, createUser, expectRejection, grantPersona, pool, sql } from "./helpers";

describe("persisted canonical curriculum", () => {
  it("persists drafts and requires independent grading, remediation, and a new attempt", async () => {
    const learner = await createUser("curriculum-attempt-owner");
    const reviewer = await createUser("curriculum-attempt-reviewer");
    await grantPersona(learner.id, "learner");
    await grantPersona(reviewer.id, "reviewer");
    const c = await pool.connect();
    try {
      await c.query("begin");
      // A rollback-only publication fixture tests commands, not real video certification.
      await c.query("update profiles set baseline_completed_at=now() where id=$1", [learner.id]);
      const { rows: [lesson] } = await c.query("update curriculum_lessons set status='published',published_at=now() where lesson_code='AF01' returning activity_id");
      const { rows: [key] } = await c.query("select definition from btg.curriculum_assessment_keys where activity_id=$1", [lesson.activity_id]);
      const become = async (id: string) => {
        await c.query("reset role");
        await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
        await c.query("set local role authenticated");
      };
      const rejects = async (query: string, values: unknown[], message: string) => {
        await c.query("savepoint denied");
        const rejection = await expectRejection(c.query(query, values));
        expect(rejection.message).toContain(message);
        await c.query("rollback to savepoint denied");
      };
      await become(learner.id);
      const { rows: [first] } = await c.query("select (start_curriculum_attempt($1)).*", [lesson.activity_id]);
      const { rows: [resumed] } = await c.query("select (start_curriculum_attempt($1)).*", [lesson.activity_id]);
      expect(resumed.id).toBe(first.id);
      const output = "My reproducible practice artifact with explicit verification and limitations.";
      await c.query("select save_curriculum_attempt($1,$2,$3,false)", [first.id, output, key.definition.answers[0].correct_option]);
      expect((await c.query("select practice_output from curriculum_attempts where id=$1", [first.id])).rows[0].practice_output).toBe(output);
      await c.query("select save_curriculum_attempt($1,$2,$3,true)", [first.id, output, key.definition.answers[0].correct_option]);
      await rejects("select claim_curriculum_attempt($1)", [first.id], "reviewer required");
      await become(reviewer.id);
      await c.query("select claim_curriculum_attempt($1)", [first.id]);
      const scores = Object.fromEntries(key.definition.answers[1].rubric.map((r: {id: string}) => [r.id, 1]));
      await rejects("select evaluate_curriculum_attempt($1,$2,$3)", [first.id, {}, "Every criterion requires evidence-based feedback."], "every rubric criterion");
      await c.query("select evaluate_curriculum_attempt($1,$2,$3)", [first.id, scores, "Add reproducible verification steps and explain the observed limitations."]);
      await become(learner.id);
      expect((await c.query("select passed from curriculum_attempts where id=$1", [first.id])).rows[0].passed).toBe(false);
      await rejects("select start_curriculum_attempt($1)", [lesson.activity_id], "remediation");
      await c.query("select acknowledge_curriculum_remediation($1)", [first.id]);
      const { rows: [retry] } = await c.query("select (start_curriculum_attempt($1)).*", [lesson.activity_id]);
      expect(retry.attempt_number).toBe(2);
      expect(retry.id).not.toBe(first.id);
      expect((await c.query("select status from curriculum_attempts where id=$1", [first.id])).rows[0].status).toBe("evaluated");
    } finally { await c.query("rollback"); c.release(); }
  });
  it("resolves all canonical competencies to five levels without orphan lesson mappings", async () => {
    const [counts] = await sql(`select
      (select count(distinct domain_code)::int from curriculum_lessons) domains,
      (select count(*)::int from curriculum_lessons) lessons,
      (select count(*)::int from competencies) competencies,
      (select count(*)::int from competency_levels) levels,
      (select count(*)::int from curriculum_lesson_video) video_mappings,
      (select count(*)::int from curriculum_lessons l cross join lateral
         jsonb_array_elements_text(l.contract->'competency_ids') s(slug)
         where not exists(select 1 from competencies c where c.slug=s.slug)) orphans`);
    expect(counts).toEqual({ domains: 11, lessons: 112, competencies: 24, levels: 120, video_mappings: 112, orphans: 0 });
  });

  it("preserves every proficiency descriptor when reapplied", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const before = await client.query("select * from competency_levels order by competency_id,level");
      await client.query(readFileSync("supabase/migrations/20260919000500_curriculum_proficiency.sql", "utf8"));
      expect((await client.query("select * from competency_levels order by competency_id,level")).rows).toEqual(before.rows);
    } finally { await client.query("rollback"); client.release(); }
  });

  it("hides draft lessons and prevents learners from writing authoritative state", async () => {
    const learner = await createUser("curriculum-security");
    await grantPersona(learner.id, "learner");
    expect(await asUser(learner.id, async c => (await c.query("select * from curriculum_lessons")).rows)).toEqual([]);
    for (const query of [
      "select * from btg.curriculum_assessment_keys",
      "update curriculum_attempts set passed=true",
      "update curriculum_playback_progress set watched='{[0,9999)}'::nummultirange",
      "update curriculum_lessons set status='published'",
    ]) {
      expect((await expectRejection(asUser(learner.id, c => c.query(query)))).code).toBe("42501");
    }
  });

  it("refuses enrollment into unpublished lessons", async () => {
    const learner = await createUser("curriculum-draft-enrollment");
    await grantPersona(learner.id, "learner");
    const [lesson] = await sql<{activity_id: string}>("select activity_id from curriculum_lessons where lesson_code='AF01'");
    const rejection = await expectRejection(asUser(learner.id, c => c.query("select start_curriculum_attempt($1)", [lesson.activity_id])));
    expect(rejection.message).toContain("published lesson required");
  });
});
