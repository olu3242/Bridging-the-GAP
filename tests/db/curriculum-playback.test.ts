import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createUser, grantPersona, pool, expectRejection } from "./helpers";

describe("bounded curriculum playback receipts", () => {
  it("deduplicates receipts, rejects seeks and isolates each learner without granting completion", async () => {
    const learner = await createUser("playback-owner");
    const other = await createUser("playback-other");
    await grantPersona(learner.id, "learner");
    await grantPersona(other.id, "learner");
    const c = await pool.connect();
    try {
      await c.query("begin");
      // Synthetic verified state and elapsed clock are rollback-only boundary fixtures.
      // This test makes no claim that a real external video played.
      const lesson = (await c.query("update curriculum_lessons set status='published',published_at=now() where lesson_code='AF01' returning activity_id")).rows[0];
      await c.query("update curriculum_lesson_video set video_id='k7HaeJs-N-o' where activity_id=$1", [lesson.activity_id]);
      await c.query(`update curriculum_videos set health_status='healthy',duration_seconds=20,verified_at=now(),
        verification='{"exists":true,"accessible":true,"embeddable":true,"renders":true,"accessible_equivalent":true}'
        where video_id=(select video_id from curriculum_lesson_video where activity_id=$1)`, [lesson.activity_id]);
      await c.query("update curriculum_lesson_video set relevance_verified_at=now() where activity_id=$1", [lesson.activity_id]);
      const become = async (id: string) => {
        await c.query("reset role"); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]); await c.query("set local role authenticated");
      };
      const reject = async (args: unknown[]) => {
        await c.query("savepoint invalid_receipt");
        const e = await expectRejection(c.query("select record_curriculum_playback($1,$2,$3,$4)", args));
        await c.query("rollback to savepoint invalid_receipt");
        return e;
      };
      await become(learner.id);
      await c.query("select begin_curriculum_playback($1,0)", [lesson.activity_id]);
      expect((await reject([lesson.activity_id,randomUUID(),0,10])).message).toContain("implausible");
      await c.query("reset role");
      await c.query("update curriculum_playback_progress set last_receipt_at=clock_timestamp()-interval '10 seconds' where activity_id=$1 and profile_id=$2", [lesson.activity_id,learner.id]);
      await become(learner.id);
      const request = randomUUID();
      await c.query("select record_curriculum_playback($1,$2,0,10)", [lesson.activity_id,request]);
      await c.query("select record_curriculum_playback($1,$2,0,10)", [lesson.activity_id,request]);
      expect((await reject([lesson.activity_id,request,0,11])).message).toContain("identity conflict");
      expect((await reject([lesson.activity_id,randomUUID(),17,20])).message).toContain("implausible");
      let progress = (await c.query("select curriculum_progress($1) value", [lesson.activity_id])).rows[0].value;
      expect(progress).toMatchObject({watched_seconds:10,last_position:10,threshold_reached:false,completed:false});
      await become(other.id);
      expect((await c.query("select * from curriculum_playback_progress where activity_id=$1", [lesson.activity_id])).rows).toEqual([]);
      await become(learner.id);
      // Resume preserves the union of previously watched ranges.
      await c.query("select begin_curriculum_playback($1,10)", [lesson.activity_id]);
      await c.query("reset role");
      await c.query("update curriculum_playback_progress set last_receipt_at=clock_timestamp()-interval '10 seconds' where activity_id=$1 and profile_id=$2", [lesson.activity_id,learner.id]);
      await become(learner.id);
      await c.query("select record_curriculum_playback($1,$2,10,20)", [lesson.activity_id,randomUUID()]);
      progress = (await c.query("select curriculum_progress($1) value", [lesson.activity_id])).rows[0].value;
      expect(progress).toMatchObject({watched_seconds:20,threshold_reached:true,completed:false});
    } finally { await c.query("rollback"); c.release(); }
  });
});
