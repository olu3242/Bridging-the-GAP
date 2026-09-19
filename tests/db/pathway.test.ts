import { describe, expect, it } from "vitest";
import {
  asUser,
  completeStepLearning,
  createUser,
  expectRejection,
  generatePathwayOnce,
  pathwaySteps,
  sql,
  walkBaseline,
} from "./helpers";

/** A learner measured at level 0 everywhere, so every competency has a gap. */
async function learnerWithGaps(label: string) {
  const learner = await createUser(label);
  await walkBaseline(learner.id, { correctly: false });
  return learner;
}

describe("pathway generation", () => {
  it("refuses to generate before a baseline exists", async () => {
    const learner = await createUser("no-baseline");
    const rejection = await expectRejection(
      asUser(learner.id, (client) => client.query("select public.generate_pathway()")),
    );
    expect(rejection.message).toContain("complete the baseline diagnostic");
  });

  it("orders steps by prerequisite depth, then widest gap", async () => {
    const learner = await learnerWithGaps("ordered");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);

    expect(steps).toHaveLength(8);
    // Depth must never decrease as position increases.
    const depths = steps.map((s) => s.depth);
    expect([...depths].sort((a, b) => a - b)).toEqual(depths);
    // A prerequisite always precedes what depends on it.
    const position = new Map(steps.map((s) => [s.competency_slug, s.position]));
    expect(position.get("ai-concepts")!).toBeLessThan(position.get("prompt-design")!);
    expect(position.get("prompt-design")!).toBeLessThan(position.get("ai-tool-workflow")!);
    expect(position.get("data-interpretation")!).toBeLessThan(position.get("applied-ai-projects")!);
  });

  it("unlocks only steps with no unmet dependency", async () => {
    const learner = await learnerWithGaps("unlocked");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);

    const available = steps.filter((s) => s.status === "available").map((s) => s.competency_slug);
    const locked = steps.filter((s) => s.status === "locked").map((s) => s.competency_slug);

    expect(available.sort()).toEqual(["ai-concepts", "ai-limitations", "data-interpretation"]);
    expect(locked).toContain("prompt-design");
    expect(locked).toContain("applied-ai-projects");
    // Every locked step names what is blocking it.
    for (const step of steps.filter((s) => s.status === "locked")) {
      expect(step.blocked_by.length).toBeGreaterThan(0);
    }
  });

  it("explains each step from the learner's own baseline", async () => {
    const learner = await learnerWithGaps("explained");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    const applied = steps.find((s) => s.competency_slug === "applied-ai-projects")!;
    expect(applied.rationale).toContain("level 0");
    expect(applied.rationale).toContain("opportunity-ready is 4");
    expect(applied.rationale).toContain("Comes after");
  });

  it("records the generation inputs on the pathway", async () => {
    const learner = await learnerWithGaps("rationale");
    const pathwayId = await generatePathwayOnce(learner.id);
    const [row] = await sql<{
      status: string;
      version: number;
      rationale: { source: string; ordering: string; steps: number };
    }>("select status, version, rationale from public.pathways where id = $1", [pathwayId]);
    expect(row.status).toBe("active");
    expect(row.version).toBe(1);
    expect(row.rationale.source).toBe("competency_baseline");
    expect(row.rationale.ordering).toContain("prerequisite_depth");
    expect(row.rationale.steps).toBe(8);
  });

  it("supersedes the previous version instead of overwriting it", async () => {
    const learner = await learnerWithGaps("versioned");
    const first = await generatePathwayOnce(learner.id);
    const second = await generatePathwayOnce(learner.id);
    expect(second).not.toBe(first);

    const rows = await sql<{ id: string; version: number; status: string; superseded_by: string | null }>(
      "select id, version, status, superseded_by from public.pathways where profile_id = $1 order by version",
      [learner.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ version: 1, status: "superseded", superseded_by: second });
    expect(rows[1]).toMatchObject({ version: 2, status: "active" });

    // The superseded plan's steps remain readable.
    const oldSteps = await pathwaySteps(learner.id, first);
    expect(oldSteps).toHaveLength(8);
  });

  it("keeps at most one active pathway", async () => {
    const learner = await learnerWithGaps("single-active");
    await generatePathwayOnce(learner.id);
    await generatePathwayOnce(learner.id);
    const [{ count }] = await sql<{ count: string }>(
      "select count(*)::text from public.pathways where profile_id = $1 and status = 'active'",
      [learner.id],
    );
    expect(count).toBe("1");
  });

  it("records an empty plan honestly when nothing needs closing", async () => {
    const learner = await createUser("at-target");
    await walkBaseline(learner.id, { correctly: true }); // level 4 everywhere
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    // Only applied-ai-projects and prompt-design target level 4, already met.
    expect(steps).toHaveLength(0);
    const [row] = await sql<{ status: string; rationale: { steps: number; note?: string } }>(
      "select status, rationale from public.pathways where id = $1",
      [pathwayId],
    );
    expect(row.status).toBe("active");
    expect(row.rationale.steps).toBe(0);
    expect(row.rationale.note).toContain("already at target");
  });

  it("audits generation and notifies once", async () => {
    const learner = await learnerWithGaps("audited-pathway");
    const pathwayId = await generatePathwayOnce(learner.id);
    const events = await sql<{ action: string }>(
      "select action from public.audit_events where object_id = $1 and action like 'pathway%'",
      [pathwayId],
    );
    expect(events.map((e) => e.action)).toEqual(["pathway.pathway.generated"]);
    const notifications = await sql<{ dedupe_key: string }>(
      "select dedupe_key from public.notifications where profile_id = $1 and category = 'pathway.generated'",
      [learner.id],
    );
    expect(notifications).toHaveLength(1);
  });

  it("keeps one learner's pathway private from another", async () => {
    const [a, b] = await Promise.all([learnerWithGaps("pw-a"), createUser("pw-b")]);
    const pathwayId = await generatePathwayOnce(a.id);
    const seen = await asUser(b.id, async (client) => {
      const result = await client.query("select id from public.pathways where id = $1", [pathwayId]);
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });

  it("gives authenticated no direct write on pathways", async () => {
    const learner = await learnerWithGaps("no-write");
    const pathwayId = await generatePathwayOnce(learner.id);
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("update public.pathways set status = 'archived' where id = $1", [pathwayId]),
      ),
    );
    expect(rejection.code).toBe("42501");
  });
});

describe("pathway steps", () => {
  it("refuses to start a locked step", async () => {
    const learner = await learnerWithGaps("locked-start");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    const locked = steps.find((s) => s.status === "locked")!;

    const rejection = await expectRejection(
      asUser(learner.id, (client) => client.query("select public.start_pathway_step($1)", [locked.id])),
    );
    expect(rejection.message).toContain("not available yet");
  });

  it("refuses to start another learner's step", async () => {
    const [a, b] = await Promise.all([learnerWithGaps("step-a"), createUser("step-b")]);
    const pathwayId = await generatePathwayOnce(a.id);
    const steps = await pathwaySteps(a.id, pathwayId);
    const open = steps.find((s) => s.status === "available")!;
    const rejection = await expectRejection(
      asUser(b.id, (client) => client.query("select public.start_pathway_step($1)", [open.id])),
    );
    expect(rejection.message).toContain("step not found");
  });

  it("rejects an illegal step transition at the database boundary", async () => {
    const learner = await learnerWithGaps("illegal");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    const locked = steps.find((s) => s.status === "locked")!;
    const rejection = await expectRejection(
      sql("update public.pathway_steps set status = 'completed', completed_at = now() where id = $1", [
        locked.id,
      ]),
    );
    expect(rejection.message).toContain("invalid pathway_step transition");
  });
});

describe("learning consumes the pathway", () => {
  it("refuses to open learning for a locked step", async () => {
    const learner = await learnerWithGaps("locked-learning");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    const locked = steps.find((s) => s.status === "locked")!;
    const rejection = await expectRejection(
      asUser(learner.id, (client) => client.query("select * from public.open_step_learning($1)", [locked.id])),
    );
    expect(rejection.message).toContain("still locked");
  });

  it("enrols the modules for the step's competency, idempotently", async () => {
    const learner = await learnerWithGaps("enrolled");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    const open = steps.find((s) => s.status === "available")!;

    for (let i = 0; i < 2; i += 1) {
      await asUser(learner.id, (client) =>
        client.query("select * from public.open_step_learning($1)", [open.id]),
      );
    }
    const rows = await sql<{ status: string; activities_total: number }>(
      "select status, activities_total from public.learner_module_progress where profile_id = $1",
      [learner.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "available", activities_total: 3 });
  });

  it("refuses to complete an activity whose module was never opened", async () => {
    const learner = await learnerWithGaps("unopened");
    await generatePathwayOnce(learner.id);
    const [activity] = await sql<{ id: string }>("select id from public.learning_activities limit 1");
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.complete_learning_activity($1, $2)", [activity.id, "x"]),
      ),
    );
    expect(rejection.message).toContain("start this module from your pathway first");
  });

  it("refuses to complete an output activity with nothing to show", async () => {
    const learner = await learnerWithGaps("no-output");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    const open = steps.find((s) => s.status === "available")!;
    await asUser(learner.id, (client) =>
      client.query("select * from public.open_step_learning($1)", [open.id]),
    );
    const [activity] = await sql<{ id: string }>(
      `select a.id from public.learner_module_progress lmp
       join public.learning_activities a on a.module_id = lmp.module_id
       where lmp.profile_id = $1 and a.requires_output limit 1`,
      [learner.id],
    );
    const rejection = await expectRejection(
      asUser(learner.id, (client) =>
        client.query("select public.complete_learning_activity($1, $2)", [activity.id, "   "]),
      ),
    );
    expect(rejection.message).toContain("needs your work");
  });

  it("completing every activity completes the module and advances the step", async () => {
    const learner = await learnerWithGaps("completer");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    const open = steps.find((s) => s.competency_slug === "ai-concepts")!;

    await completeStepLearning(learner.id, open.id);

    const [progress] = await sql<{ status: string; activities_completed: number }>(
      `select status, activities_completed from public.learner_module_progress
       where profile_id = $1 and pathway_step_id = $2`,
      [learner.id, open.id],
    );
    expect(progress).toMatchObject({ status: "completed", activities_completed: 3 });

    // The step moves, but does not close: this competency asks for evidence,
    // and closing it without a verified skill is what verification.test.ts
    // asserts must not happen.
    const after = await pathwaySteps(learner.id, pathwayId);
    expect(after.find((s) => s.id === open.id)!.status).toBe("in_progress");
  });

  it("keeps the dependent step locked until the prerequisite is verified", async () => {
    const learner = await learnerWithGaps("unlocker");
    const pathwayId = await generatePathwayOnce(learner.id);
    const before = await pathwaySteps(learner.id, pathwayId);
    expect(before.find((s) => s.competency_slug === "prompt-design")!.status).toBe("locked");

    await completeStepLearning(learner.id, before.find((s) => s.competency_slug === "ai-concepts")!.id);

    // Learning alone does not unlock what came after it.
    const after = await pathwaySteps(learner.id, pathwayId);
    const promptDesign = after.find((s) => s.competency_slug === "prompt-design")!;
    expect(promptDesign.status).toBe("locked");
    expect(promptDesign.blocked_by).toEqual(["How AI systems work"]);
  });

  it("audits every activity and the module completion", async () => {
    const learner = await learnerWithGaps("audited-learning");
    const pathwayId = await generatePathwayOnce(learner.id);
    const steps = await pathwaySteps(learner.id, pathwayId);
    const open = steps.find((s) => s.competency_slug === "ai-limitations")!;
    await completeStepLearning(learner.id, open.id);

    const actions = await sql<{ action: string }>(
      `select action from public.audit_events
       where actor_profile_id = $1 and (action like 'learning%' or action like 'pathway.step%')
       order by occurred_at`,
      [learner.id],
    );
    expect(actions.map((a) => a.action)).toEqual([
      "learning.activity.completed",
      "learning.activity.completed",
      "learning.module.completed",
    ]);
  });

  it("keeps one learner's progress private from another", async () => {
    const [a, b] = await Promise.all([learnerWithGaps("prog-a"), createUser("prog-b")]);
    const pathwayId = await generatePathwayOnce(a.id);
    const steps = await pathwaySteps(a.id, pathwayId);
    await completeStepLearning(a.id, steps.find((s) => s.status === "available")!.id);

    const seen = await asUser(b.id, async (client) => {
      const result = await client.query(
        "select module_id from public.learner_learning_view where profile_id = $1",
        [a.id],
      );
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });
});
