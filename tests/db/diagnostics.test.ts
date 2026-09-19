import { describe, expect, it } from "vitest";
import {
  asUser,
  completeOnboarding,
  correctOptionFor,
  createUser,
  expectRejection,
  nextQuestionFor,
  sql,
  startBaseline,
  walkBaseline,
} from "./helpers";

describe("competency graph", () => {
  it("seeds the catalogue", async () => {
    const [counts] = await sql<{ domains: string; competencies: string; levels: string; prereqs: string }>(`
      select (select count(*)::text from public.competency_domains) as domains,
             (select count(*)::text from public.competencies) as competencies,
             (select count(*)::text from public.competency_levels) as levels,
             (select count(*)::text from public.competency_prerequisites) as prereqs`);
    expect(counts).toEqual({ domains: "4", competencies: "8", levels: "40", prereqs: "6" });
  });

  it("rejects a prerequisite cycle", async () => {
    const [a] = await sql<{ id: string }>("select id from public.competencies where slug = 'ai-concepts'");
    const [b] = await sql<{ id: string }>("select id from public.competencies where slug = 'prompt-design'");
    // prompt-design already requires ai-concepts; the reverse would close a loop.
    const rejection = await expectRejection(
      sql("insert into public.competency_prerequisites (competency_id, prerequisite_id) values ($1, $2)", [
        a.id,
        b.id,
      ]),
    );
    expect(rejection.message).toContain("prerequisite cycle");
  });

  it("rejects a competency requiring itself", async () => {
    const [a] = await sql<{ id: string }>("select id from public.competencies where slug = 'ai-ethics'");
    const rejection = await expectRejection(
      sql("insert into public.competency_prerequisites (competency_id, prerequisite_id) values ($1, $1)", [
        a.id,
      ]),
    );
    expect(rejection.code).toBe("23514");
  });
});

describe("question bank integrity", () => {
  it("publishes exactly one baseline with a full question set", async () => {
    const [row] = await sql<{ baselines: string; questions: string; keys: string }>(`
      select (select count(*)::text from public.diagnostics where is_baseline and status = 'published') as baselines,
             (select count(*)::text from public.diagnostic_questions) as questions,
             (select count(*)::text from public.diagnostic_answer_keys) as keys`);
    expect(row).toEqual({ baselines: "1", questions: "24", keys: "24" });
  });

  it("refuses a second published baseline", async () => {
    const rejection = await expectRejection(
      sql(`insert into public.diagnostics (slug, title, status, is_baseline)
           values ('rival-baseline', 'Rival baseline', 'published', true)`),
    );
    expect(rejection.code).toBe("23505");
  });

  it("spreads the correct answer across option positions", async () => {
    const rows = await sql<{ correct: string; count: string }>(
      "select correct_option_ids[1] as correct, count(*)::text from public.diagnostic_answer_keys group by 1",
    );
    // A learner must not be able to score by always picking the same slot.
    expect(rows.length).toBeGreaterThan(1);
    expect(Math.max(...rows.map((r) => Number(r.count)))).toBeLessThan(24);
  });

  it("keeps the key pointing at a real option on every question", async () => {
    const [{ mismatched }] = await sql<{ mismatched: string }>(`
      select count(*)::text as mismatched
      from public.diagnostic_answer_keys k
      join public.diagnostic_questions q on q.id = k.question_id
      where not exists (
        select 1 from jsonb_array_elements(q.options) o
        where o.value->>'id' = k.correct_option_ids[1]
      )`);
    expect(mismatched).toBe("0");
  });
});

describe("answer key confidentiality", () => {
  it("does not let a learner read the answer keys", async () => {
    const learner = await createUser("peeker");
    const rejection = await expectRejection(
      asUser(learner.id, (client) => client.query("select * from public.diagnostic_answer_keys")),
    );
    expect(rejection.code).toBe("42501");
  });

  it("does not let a learner read whether their answer was correct", async () => {
    const learner = await createUser("grader");
    const attemptId = await startBaseline(learner.id);
    const question = await nextQuestionFor(learner.id, attemptId);
    const correct = await correctOptionFor(question!.question_id);
    await asUser(learner.id, (client) =>
      client.query("select public.answer_diagnostic_question($1, $2, $3)", [
        attemptId,
        question!.question_id,
        [correct],
      ]),
    );

    // The row is visible; the grade is not.
    const visible = await asUser(learner.id, async (client) => {
      const result = await client.query(
        "select question_id, selected_option_ids from public.diagnostic_responses where attempt_id = $1",
        [attemptId],
      );
      return result.rowCount;
    });
    expect(visible).toBe(1);

    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select is_correct from public.diagnostic_responses where attempt_id = $1", [attemptId]),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("does not expose correctness through the question bank", async () => {
    const learner = await createUser("reader");
    const columns = await asUser(learner.id, async (client) => {
      const result = await client.query(
        `select column_name from information_schema.columns
         where table_name = 'diagnostic_questions' and table_schema = 'public'`,
      );
      return (result.rows as { column_name: string }[]).map((r) => r.column_name);
    });
    expect(columns).not.toContain("correct_option_ids");
  });
});

describe("attempt lifecycle", () => {
  it("resumes rather than starting a second attempt", async () => {
    const learner = await createUser("resumer");
    const first = await startBaseline(learner.id);
    const second = await startBaseline(learner.id);
    expect(second).toBe(first);

    const [{ count }] = await sql<{ count: string }>(
      "select count(*)::text from public.diagnostic_attempts where profile_id = $1",
      [learner.id],
    );
    expect(count).toBe("1");
  });

  it("refuses to jump an attempt straight to scored", async () => {
    const learner = await createUser("jumper");
    const attemptId = await startBaseline(learner.id);
    const rejection = await expectRejection(
      sql("update public.diagnostic_attempts set status = 'scored', scored_at = now() where id = $1", [
        attemptId,
      ]),
    );
    expect(rejection.message).toContain("invalid diagnostic_attempt transition");
  });

  it("refuses to submit an attempt with no answers", async () => {
    const learner = await createUser("empty");
    const attemptId = await startBaseline(learner.id);
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.submit_diagnostic_attempt($1)", [attemptId]),
      ),
    );
    expect(rejection.message).toContain("answer at least one question");
  });

  it("refuses to touch another learner's attempt", async () => {
    const [owner, intruder] = await Promise.all([createUser("owner"), createUser("intruder")]);
    const attemptId = await startBaseline(owner.id);
    const question = await nextQuestionFor(owner.id, attemptId);

    const rejection = await expectRejection(
      asUser(intruder.id, (client) =>
        client.query("select public.answer_diagnostic_question($1, $2, $3)", [
          attemptId,
          question!.question_id,
          ["a"],
        ]),
      ),
    );
    expect(rejection.message).toContain("attempt not found");

    const seen = await asUser(intruder.id, async (client) => {
      const result = await client.query("select id from public.diagnostic_attempts where id = $1", [attemptId]);
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });

  it("refuses an option that is not on the question", async () => {
    const learner = await createUser("inventor");
    const attemptId = await startBaseline(learner.id);
    const question = await nextQuestionFor(learner.id, attemptId);
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.answer_diagnostic_question($1, $2, $3)", [
          attemptId,
          question!.question_id,
          ["zz"],
        ]),
      ),
    );
    expect(rejection.message).toContain("not an option");
  });

  it("refuses two answers to the same question", async () => {
    const learner = await createUser("repeater");
    const attemptId = await startBaseline(learner.id);
    const question = await nextQuestionFor(learner.id, attemptId);
    const correct = await correctOptionFor(question!.question_id);
    await asUser(learner.id, (client) =>
      client.query("select public.answer_diagnostic_question($1, $2, $3)", [
        attemptId,
        question!.question_id,
        [correct],
      ]),
    );
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.answer_diagnostic_question($1, $2, $3)", [
          attemptId,
          question!.question_id,
          [correct],
        ]),
      ),
    );
    expect(rejection.code).toBe("23505");
  });
});

describe("adaptive walk", () => {
  it("opens at level 2 and steps up after a correct answer", async () => {
    const learner = await createUser("climber");
    const attemptId = await startBaseline(learner.id);
    const first = await nextQuestionFor(learner.id, attemptId);
    expect(first!.level).toBe(2);

    const correct = await correctOptionFor(first!.question_id);
    await asUser(learner.id, (client) =>
      client.query("select public.answer_diagnostic_question($1, $2, $3)", [
        attemptId,
        first!.question_id,
        [correct],
      ]),
    );

    const second = await nextQuestionFor(learner.id, attemptId);
    expect(second!.competency_id).toBe(first!.competency_id);
    expect(second!.level).toBe(4);
  });

  it("steps down after a wrong answer", async () => {
    const learner = await createUser("stepper");
    const attemptId = await startBaseline(learner.id);
    const first = await nextQuestionFor(learner.id, attemptId);
    const correct = await correctOptionFor(first!.question_id);
    const wrong = first!.options.find((o) => o.id !== correct)!.id;

    await asUser(learner.id, (client) =>
      client.query("select public.answer_diagnostic_question($1, $2, $3)", [
        attemptId,
        first!.question_id,
        [wrong],
      ]),
    );

    const second = await nextQuestionFor(learner.id, attemptId);
    expect(second!.competency_id).toBe(first!.competency_id);
    expect(second!.level).toBe(1);
  });

  it("covers every competency twice and then stops", async () => {
    const learner = await createUser("walker");
    const { asked } = await walkBaseline(learner.id, { correctly: true });
    expect(asked).toHaveLength(16);
    const perCompetency = new Map<string, number>();
    for (const a of asked) perCompetency.set(a.competency_id, (perCompetency.get(a.competency_id) ?? 0) + 1);
    expect(perCompetency.size).toBe(8);
    expect([...perCompetency.values()]).toEqual(Array(8).fill(2));
  });
});

describe("scoring writes the baseline", () => {
  it("estimates the highest level answered correctly", async () => {
    const learner = await createUser("scorer");
    await walkBaseline(learner.id, { correctly: true });

    const rows = await sql<{ level: number; confidence: string; source: string }>(
      "select level, confidence, source from public.learner_competencies where profile_id = $1",
      [learner.id],
    );
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.level === 4)).toBe(true);
    expect(rows.every((r) => r.source === "baseline")).toBe(true);
    expect(rows.every((r) => Number(r.confidence) === 0.65)).toBe(true);
  });

  it("records level 0 when nothing was answered correctly", async () => {
    const learner = await createUser("zero");
    await walkBaseline(learner.id, { correctly: false });
    const rows = await sql<{ level: number }>(
      "select level from public.learner_competencies where profile_id = $1",
      [learner.id],
    );
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.level === 0)).toBe(true);
  });

  it("marks the attempt scored with a per-competency result", async () => {
    const learner = await createUser("resulted");
    const { attemptId } = await walkBaseline(learner.id, { correctly: true });
    const [attempt] = await sql<{ status: string; result: { answered: number; competencies: unknown[] } }>(
      "select status, result from public.diagnostic_attempts where id = $1",
      [attemptId],
    );
    expect(attempt.status).toBe("scored");
    expect(attempt.result.answered).toBe(16);
    expect(attempt.result.competencies).toHaveLength(8);
  });

  it("stamps the routing flag only for the baseline diagnostic", async () => {
    const learner = await createUser("flagged");
    await walkBaseline(learner.id, { correctly: true });
    const [profile] = await sql<{ baseline_completed_at: string | null }>(
      "select baseline_completed_at from public.profiles where id = $1",
      [learner.id],
    );
    expect(profile.baseline_completed_at).not.toBeNull();
  });

  it("audits and notifies exactly once", async () => {
    const learner = await createUser("audited-baseline");
    const { attemptId } = await walkBaseline(learner.id, { correctly: true });

    const events = await sql<{ action: string }>(
      `select action from public.audit_events
       where actor_profile_id = $1 and action like 'diagnostic%' order by occurred_at`,
      [learner.id],
    );
    expect(events.map((e) => e.action)).toEqual([
      "diagnostic.attempt.started",
      "diagnostic.attempt.scored",
    ]);

    const notifications = await sql<{ category: string; dedupe_key: string }>(
      "select category, dedupe_key from public.notifications where profile_id = $1 and category = 'baseline.scored'",
      [learner.id],
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0].dedupe_key).toBe(`baseline.scored:${attemptId}`);
  });

  it("refuses to submit an attempt twice", async () => {
    const learner = await createUser("double");
    const { attemptId } = await walkBaseline(learner.id, { correctly: true });
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.submit_diagnostic_attempt($1)", [attemptId]),
      ),
    );
    expect(rejection.message).toContain("already been submitted");
  });

  it("refuses further answers once submitted", async () => {
    const learner = await createUser("late");
    const attemptId = await startBaseline(learner.id);
    const question = await nextQuestionFor(learner.id, attemptId);
    const correct = await correctOptionFor(question!.question_id);
    await asUser(learner.id, (client) =>
      client.query("select public.answer_diagnostic_question($1, $2, $3)", [
        attemptId,
        question!.question_id,
        [correct],
      ]),
    );
    await asUser(learner.id, (client) =>
      client.query("select public.submit_diagnostic_attempt($1)", [attemptId]),
    );

    const next = await nextQuestionFor(learner.id, attemptId);
    expect(next).toBeNull();

    const other = await sql<{ id: string }>(
      `select q.id from public.diagnostic_questions q where q.id <> $1 limit 1`,
      [question!.question_id],
    );
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.answer_diagnostic_question($1, $2, $3)", [
          attemptId,
          other[0].id,
          ["a"],
        ]),
      ),
    );
    expect(rejection.message).toContain("no longer open");
  });
});

describe("gap read model", () => {
  it("reports the gap to target and the unmet prerequisites", async () => {
    const learner = await createUser("gapped");
    await walkBaseline(learner.id, { correctly: false }); // every level 0

    const rows = await asUser(learner.id, async (client) => {
      const result = await client.query(
        `select slug, level, target_level, gap, unmet_prerequisites
         from public.learner_competency_gaps where profile_id = $1 order by slug`,
        [learner.id],
      );
      return result.rows as Array<{
        slug: string;
        level: number;
        target_level: number;
        gap: number;
        unmet_prerequisites: string[];
      }>;
    });

    expect(rows).toHaveLength(8);
    const applied = rows.find((r) => r.slug === "applied-ai-projects")!;
    expect(applied.level).toBe(0);
    expect(applied.target_level).toBe(4);
    expect(applied.gap).toBe(4);
    // Both prerequisites sit below their minimum level, so both are listed.
    expect(applied.unmet_prerequisites.sort()).toEqual(["Interpreting data", "Prompt design"]);
  });

  it("clears an unmet prerequisite once the level is reached", async () => {
    const learner = await createUser("progressed");
    await walkBaseline(learner.id, { correctly: true }); // every level 4

    const rows = await asUser(learner.id, async (client) => {
      const result = await client.query(
        "select slug, gap, unmet_prerequisites from public.learner_competency_gaps where profile_id = $1",
        [learner.id],
      );
      return result.rows as Array<{ slug: string; gap: number; unmet_prerequisites: string[] }>;
    });
    const applied = rows.find((r) => r.slug === "applied-ai-projects")!;
    expect(applied.unmet_prerequisites).toEqual([]);
    expect(applied.gap).toBe(0);
  });

  it("keeps one learner's baseline private from another", async () => {
    const [a, b] = await Promise.all([createUser("private-a"), createUser("private-b")]);
    await walkBaseline(a.id, { correctly: true });

    const seen = await asUser(b.id, async (client) => {
      const result = await client.query(
        "select competency_id from public.learner_competency_gaps where profile_id = $1",
        [a.id],
      );
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });

  it("lets a governing organization see an active member's baseline", async () => {
    const [admin, member] = await Promise.all([createUser("gov-admin"), createUser("gov-member")]);
    const slug = `gov-${Date.now().toString(36)}`;
    const [org] = await asUser(admin.id, async (client) => {
      const result = await client.query(
        "select (public.create_organization('Gov Uni', $1, 'institution')).id as id",
        [slug],
      );
      return result.rows as { id: string }[];
    });
    await sql(
      `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
       values ($1, $2, 'mentor', 'active', now())`,
      [org.id, member.id],
    );
    await walkBaseline(member.id, { correctly: true });

    const seen = await asUser(admin.id, async (client) => {
      const result = await client.query(
        "select competency_id from public.learner_competency_gaps where profile_id = $1",
        [member.id],
      );
      return result.rowCount;
    });
    expect(seen).toBe(8);
  });
});

describe("journey convergence", () => {
  it("onboarding then baseline leaves a learner ready for the product", async () => {
    const learner = await createUser("converged");
    await completeOnboarding(learner.id);
    const [before] = await sql<{ onboarding_state: string; baseline_completed_at: string | null }>(
      "select onboarding_state, baseline_completed_at from public.profiles where id = $1",
      [learner.id],
    );
    expect(before.onboarding_state).toBe("completed");
    expect(before.baseline_completed_at).toBeNull();

    await walkBaseline(learner.id, { correctly: true });

    const [after] = await sql<{ baseline_completed_at: string | null }>(
      "select baseline_completed_at from public.profiles where id = $1",
      [learner.id],
    );
    expect(after.baseline_completed_at).not.toBeNull();
  });
});
