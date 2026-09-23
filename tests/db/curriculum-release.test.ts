import { describe, expect, it } from "vitest";
import { asUser, createUser, expectRejection, grantPersona, pool } from "./helpers";

/**
 * The release console reports readiness and publishes in bulk. Both must be
 * strictly weaker than `publish_curriculum_lesson`: they may explain a gate and
 * they may satisfy one, but they may never route around one.
 */
describe("curriculum release console", () => {
  it("refuses readiness and bulk publication to a learner", async () => {
    const learner = await createUser("release-learner");
    await grantPersona(learner.id, "learner");
    await asUser(learner.id, async (c) => {
      expect((await expectRejection(c.query("select curriculum_release_readiness()"))).message).toContain("operator required");
      await c.query("rollback");
      await c.query("begin");
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [learner.id]);
      await c.query("set local role authenticated");
      expect(
        (await expectRejection(c.query("select publish_ready_curriculum_lessons($1)", ["BTG curriculum production release"])))
          .message,
      ).toContain("operator required");
    }, { commit: false });
  });

  it("reports every lesson with the reason it is held", async () => {
    const operator = await createUser("release-operator-report");
    await grantPersona(operator.id, "operator");
    const rows = await asUser(operator.id, async (c) => {
      const { rows } = await c.query("select curriculum_release_readiness() as report");
      return rows[0].report as Record<string, unknown>[];
    }, { commit: false });

    expect(rows.length).toBe(112);
    // Every lesson carries a protected assessment definition, so that gate is
    // satisfied across the catalog and is never the reported blocker.
    expect(rows.every((row) => row.assessment_ready === true)).toBe(true);
    // 101 lessons declare a video requirement; 11 capstones do not.
    expect(rows.filter((row) => row.video_required === true).length).toBe(101);
    expect(rows.filter((row) => row.video_required === false).length).toBe(11);
    // No video has been verified, so no required-video lesson can be ready.
    expect(rows.filter((row) => row.video_health === "healthy").length).toBe(0);
    expect(rows.filter((row) => row.video_relevance_verified === true).length).toBe(0);
  });

  it("publishes nothing while videos are unverified, and names the blocker", async () => {
    const operator = await createUser("release-operator-blocked");
    await grantPersona(operator.id, "operator");
    const summary = await asUser(operator.id, async (c) => {
      const { rows } = await c.query("select publish_ready_curriculum_lessons($1) as result", [
        "BTG curriculum production release",
      ]);
      return rows[0].result as {
        published_this_run: number;
        total_published: number;
        total_lessons: number;
        blocked: number;
        blockers: { lesson_code: string; reason: string }[];
      };
    }, { commit: false });

    expect(summary.total_lessons).toBe(112);
    expect(summary.published_this_run).toBe(0);
    expect(summary.total_published).toBe(0);
    expect(summary.blocked).toBe(112);

    const byReason = new Map<string, number>();
    for (const blocker of summary.blockers) byReason.set(blocker.reason, (byReason.get(blocker.reason) ?? 0) + 1);
    // Root cause, not first-failure: the 101 required-video lessons report their
    // own media gate even though 97 of them also have unpublished prerequisites,
    // because that prerequisite failure is downstream of another lesson's media.
    // Only the 11 capstones, which need no video of their own, are genuinely
    // waiting on a prerequisite.
    expect(byReason.get("video_pending: required source, playback, embedding and relevance must be verified")).toBe(101);
    expect(byReason.get("prerequisite curriculum is not published")).toBe(11);
  });

  it("publishes a lesson once its gates are genuinely met, and is idempotent", async () => {
    const operator = await createUser("release-operator-publish");
    await grantPersona(operator.id, "operator");
    const c = await pool.connect();
    try {
      await c.query("begin");
      // AF01 is a domain entry lesson: it has no prerequisites, so the only gate
      // standing between it and publication is its own media requirement. Satisfy
      // that gate honestly — a healthy asset with a real duration, a verified
      // relevance stamp and bounds inside the asset — rather than disabling it.
      // The schema refuses a shortcut here: `health_status='healthy'` is only
      // accepted alongside verified_at, a duration and a verification record
      // asserting the asset exists, renders, embeds and has an accessible
      // equivalent. This fixture supplies all of it inside a rolled-back
      // transaction; it does not weaken the constraint.
      const videoId = "relfixture01".slice(0, 11);
      await c.query(
        `insert into curriculum_videos(video_id,source_url,embed_url,candidate_title,health_status,
           duration_seconds,verified_at,verification)
         values($1,'https://www.youtube.com/watch?v='||$1,'https://www.youtube.com/embed/'||$1,
                'Release fixture asset','healthy',600,now(),
                '{"exists":true,"renders":true,"accessible":true,"embeddable":true,"accessible_equivalent":true}'::jsonb)`,
        [videoId],
      );
      await c.query(
        `update curriculum_lesson_video
         set video_id=$1, relevance_verified_at=now(), start_seconds=0, end_seconds=300
         where activity_id=(select activity_id from curriculum_lessons where lesson_code='AF01')`,
        [videoId],
      );
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [operator.id]);
      await c.query("set local role authenticated");

      const first = (await c.query("select publish_ready_curriculum_lessons($1) as r", ["BTG curriculum production release"])).rows[0].r;
      expect(first.published_this_run).toBeGreaterThanOrEqual(1);

      const second = (await c.query("select publish_ready_curriculum_lessons($1) as r", ["BTG curriculum production release"])).rows[0].r;
      // Idempotent: a second run publishes nothing new and does not disturb the first.
      expect(second.published_this_run).toBe(0);
      expect(second.total_published).toBe(first.total_published);

      await c.query("reset role");
      const audit = await c.query(
        `select count(*)::int as count from audit_events
         where action='curriculum.lesson.published' and after->>'reason'=$1`,
        ["BTG curriculum production release"],
      );
      expect(audit.rows[0].count).toBe(first.published_this_run);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  });

  it("requires a substantive publication reason", async () => {
    const operator = await createUser("release-operator-reason");
    await grantPersona(operator.id, "operator");
    await asUser(operator.id, async (c) => {
      expect((await expectRejection(c.query("select publish_ready_curriculum_lessons($1)", ["short"]))).message).toContain(
        "publication reason required",
      );
    }, { commit: false });
  });
});

/**
 * The readiness SQL and the TypeScript that consumes it are one contract split
 * across two languages. A renamed or missing key would not throw — it would read
 * as `undefined` and quietly mark lessons ready. This runs the real function
 * output through the real derivation to prove the two still agree.
 */
describe("readiness contract between SQL and TypeScript", () => {
  it("derives the same picture from live rows", async () => {
    const { deriveReadiness } = await import("@/domain/curriculum/readiness");
    const operator = await createUser("release-contract");
    await grantPersona(operator.id, "operator");
    const rows = await asUser(operator.id, async (c) => {
      const { rows } = await c.query("select curriculum_release_readiness() as report");
      return rows[0].report;
    }, { commit: false });

    const summary = deriveReadiness(rows);
    expect(summary.total).toBe(112);
    expect(summary.draft).toBe(112);
    expect(summary.published).toBe(0);
    // Nothing is ready while no video is verified.
    expect(summary.ready).toBe(0);
    // Buckets are exclusive and account for every held lesson.
    expect(summary.mediaBlocked + summary.prerequisiteBlocked + summary.assessmentBlocked).toBe(112);
    expect(summary.mediaBlocked).toBe(101);
    expect(summary.prerequisiteBlocked).toBe(11);
    expect(summary.assessmentBlocked).toBe(0);
    // Media states account for the whole catalog.
    expect(summary.media.unmapped + summary.media.verification_pending + summary.media.not_required).toBe(112);
    expect(summary.media.verified).toBe(0);
    expect(summary.byDomain).toHaveLength(11);
    // Every lesson carries at least one human-readable blocker.
    expect(summary.lessons.every((lesson) => lesson.blockers.length > 0)).toBe(true);
  });
});
