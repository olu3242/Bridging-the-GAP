import { describe, expect, it } from "vitest";
import {
  asUser,
  createUser,
  expectRejection,
  generatePathwayOnce,
  pathwaySteps,
  sql,
  walkBaseline,
} from "./helpers";

async function learnerWithPathway(label: string) {
  const learner = await createUser(label);
  await walkBaseline(learner.id, { correctly: false });
  const pathwayId = await generatePathwayOnce(learner.id);
  const steps = await pathwaySteps(learner.id, pathwayId);
  return { learner, steps };
}

async function openSession(userId: string, stepId: string): Promise<string> {
  return asUser(userId, async (client) => {
    const result = await client.query("select (public.open_tutor_session($1)).id as id", [stepId]);
    return result.rows[0].id as string;
  });
}

async function recordTurn(
  userId: string,
  sessionId: string,
  outcome: string,
  options: { response?: string | null; refusal?: string | null } = {},
) {
  return asUser(userId, (client) =>
    client.query(
      "select public.record_tutor_turn($1, 'explain', $2, $3, '2026-09-18.1', '2026-09-18.1', $4, $5, $6)",
      [
        sessionId,
        "Why does my prompt keep returning vague answers?",
        outcome,
        options.response ?? null,
        "claude-opus-5",
        options.refusal ?? null,
      ],
    ),
  );
}

describe("tutor sessions are bound to the learner's own context", () => {
  it("opens a session against the learner's own step", async () => {
    const { learner, steps } = await learnerWithPathway("tutee");
    const open = steps.find((s) => s.status === "available")!;
    const sessionId = await openSession(learner.id, open.id);

    const [row] = await sql<{ profile_id: string; competency_id: string }>(
      "select profile_id, competency_id from public.tutor_sessions where id = $1",
      [sessionId],
    );
    expect(row.profile_id).toBe(learner.id);
    expect(row.competency_id).toBe(open.competency_id);
  });

  it("refuses to open a session against another learner's step", async () => {
    const [a, b] = await Promise.all([learnerWithPathway("ctx-a"), createUser("ctx-b")]);
    const open = a.steps.find((s) => s.status === "available")!;
    const rejection = await expectRejection(openSession(b.id, open.id));
    expect(rejection.message).toContain("step not found");
  });

  it("reuses a recent session for the same context", async () => {
    const { learner, steps } = await learnerWithPathway("reuser");
    const open = steps.find((s) => s.status === "available")!;
    const first = await openSession(learner.id, open.id);
    const second = await openSession(learner.id, open.id);
    expect(second).toBe(first);
  });

  it("gives the tutor only the approved context, never an answer key", async () => {
    const { learner, steps } = await learnerWithPathway("scoped");
    const open = steps.find((s) => s.status === "available")!;
    const sessionId = await openSession(learner.id, open.id);

    const context = await asUser(learner.id, async (client) => {
      const result = await client.query("select public.tutor_context($1) as ctx", [sessionId]);
      return result.rows[0].ctx as Record<string, unknown>;
    });

    expect(Object.keys(context).sort()).toEqual([
      "activities_completed",
      "competency",
      "goal",
      "measured_level",
      "module",
      "step",
    ]);
    // Nothing gradeable is in scope.
    expect(JSON.stringify(context)).not.toMatch(/correct_option|answer_key/i);
  });

  it("refuses context for someone else's session", async () => {
    const [a, b] = await Promise.all([learnerWithPathway("own"), createUser("other")]);
    const open = a.steps.find((s) => s.status === "available")!;
    const sessionId = await openSession(a.learner.id, open.id);
    const rejection = await expectRejection(
      asUser(b.id, (client) => client.query("select public.tutor_context($1)", [sessionId])),
    );
    expect(rejection.message).toContain("session not found");
  });
});

describe("the transcript records every outcome", () => {
  it("records a delivered turn with its governance metadata", async () => {
    const { learner, steps } = await learnerWithPathway("delivered");
    const sessionId = await openSession(learner.id, steps.find((s) => s.status === "available")!.id);
    await recordTurn(learner.id, sessionId, "delivered", { response: "Name the audience and the format." });

    const [turn] = await sql<{
      outcome: string;
      policy_version: string;
      instruction_version: string;
      model: string;
      ordinal: number;
    }>("select outcome, policy_version, instruction_version, model, ordinal from public.tutor_turns where session_id = $1", [
      sessionId,
    ]);
    expect(turn).toMatchObject({
      outcome: "delivered",
      policy_version: "2026-09-18.1",
      instruction_version: "2026-09-18.1",
      model: "claude-opus-5",
      ordinal: 1,
    });
  });

  it("records a refusal as fully as an answer", async () => {
    const { learner, steps } = await learnerWithPathway("refused");
    const sessionId = await openSession(learner.id, steps.find((s) => s.status === "available")!.id);
    await recordTurn(learner.id, sessionId, "refused_scope", {
      response: "I won't write your submission.",
      refusal: "The learner asked the tutor to produce graded work.",
    });

    const [turn] = await sql<{ outcome: string; refusal_reason: string }>(
      "select outcome, refusal_reason from public.tutor_turns where session_id = $1",
      [sessionId],
    );
    expect(turn.outcome).toBe("refused_scope");
    expect(turn.refusal_reason).toContain("graded work");
  });

  it("requires a reason on any non-delivered outcome", async () => {
    const { learner, steps } = await learnerWithPathway("no-reason");
    const sessionId = await openSession(learner.id, steps.find((s) => s.status === "available")!.id);
    const rejection = await expectRejection(
      recordTurn(learner.id, sessionId, "refused_policy", { response: "Declined." }),
    );
    expect(rejection.code).toBe("23514");
  });

  it("requires a response on a delivered outcome", async () => {
    const { learner, steps } = await learnerWithPathway("no-response");
    const sessionId = await openSession(learner.id, steps.find((s) => s.status === "available")!.id);
    const rejection = await expectRejection(recordTurn(learner.id, sessionId, "delivered"));
    expect(rejection.code).toBe("23514");
  });

  it("audits a refusal more loudly than an answer", async () => {
    const { learner, steps } = await learnerWithPathway("audited-tutor");
    const sessionId = await openSession(learner.id, steps.find((s) => s.status === "available")!.id);
    await recordTurn(learner.id, sessionId, "delivered", { response: "Here is the idea." });
    await recordTurn(learner.id, sessionId, "refused_policy", {
      response: "I can't claim that.",
      refusal: "The response claimed an outcome the tutor cannot grant.",
    });

    const events = await sql<{ action: string; severity: string }>(
      `select action, severity from public.audit_events
       where actor_profile_id = $1 and action like 'tutor.turn%' order by occurred_at`,
      [learner.id],
    );
    expect(events).toEqual([
      { action: "tutor.turn.delivered", severity: "info" },
      { action: "tutor.turn.refused_policy", severity: "notice" },
    ]);
  });

  it("keeps the transcript append-only", async () => {
    const { learner, steps } = await learnerWithPathway("immutable-tutor");
    const sessionId = await openSession(learner.id, steps.find((s) => s.status === "available")!.id);
    await recordTurn(learner.id, sessionId, "delivered", { response: "Original answer." });
    const [turn] = await sql<{ id: string }>("select id from public.tutor_turns where session_id = $1", [
      sessionId,
    ]);

    const update = await expectRejection(
      sql("update public.tutor_turns set tutor_response = 'rewritten' where id = $1", [turn.id]),
    );
    expect(update.message).toContain("append-only");

    const remove = await expectRejection(
      sql("delete from public.tutor_turns where id = $1", [turn.id]),
    );
    expect(remove.message).toContain("append-only");
  });

  it("gives authenticated no direct write on the transcript", async () => {
    const { learner, steps } = await learnerWithPathway("no-direct-write");
    const sessionId = await openSession(learner.id, steps.find((s) => s.status === "available")!.id);
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query(
          `insert into public.tutor_turns
             (session_id, profile_id, ordinal, intent, learner_message, tutor_response, outcome,
              policy_version, instruction_version)
           values ($1, $2, 99, 'explain', 'forged', 'forged answer', 'delivered', 'x', 'y')`,
          [sessionId, learner.id],
        ),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("keeps one learner's transcript private from another", async () => {
    const [a, b] = await Promise.all([learnerWithPathway("priv-a"), createUser("priv-b")]);
    const sessionId = await openSession(a.learner.id, a.steps.find((s) => s.status === "available")!.id);
    await recordTurn(a.learner.id, sessionId, "delivered", { response: "Private coaching." });

    const seen = await asUser(b.id, async (client) => {
      const result = await client.query("select id from public.tutor_turns where session_id = $1", [
        sessionId,
      ]);
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });
});

describe("the tutor cannot reach authoritative state", () => {
  it("has no write path to verified skills, credentials or competency level", async () => {
    // Structural check: the tutor commands are the only ones granted to
    // authenticated, and none of them touch these tables.
    const grants = await sql<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated'
         and table_name in ('verified_skills','credentials','learner_competencies','evidence')
         and privilege_type in ('INSERT','UPDATE','DELETE')`,
    );
    expect(grants).toEqual([]);
  });

  it("does not expose answer keys to any tutor function", async () => {
    const definitions = await sql<{ prosrc: string }>(
      `select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like '%tutor%'`,
    );
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.prosrc).not.toMatch(/diagnostic_answer_keys/);
    }
  });
});
