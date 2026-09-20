import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createUser, grantPersona, pool } from "./helpers";

const seed = readFileSync("supabase/seeds/curriculum-v1.sql", "utf8");

describe("canonical curriculum draft seed", () => {
  it("is rerunnable, preserves legacy records, and keeps all 112 drafts behind RLS", async () => {
    const learner = await createUser("curriculum-learner");
    const operator = await createUser("curriculum-operator");
    await grantPersona(operator.id, "operator");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: legacy } = await client.query("select * from learning_activities where slug not like 'curriculum-v1-%' order by id");
      const { rows: progress } = await client.query("select * from learner_module_progress order by profile_id,module_id");
      await client.query(seed);
      const first = await client.query("select id,module_id,slug,body from learning_activities where slug like 'curriculum-v1-%' order by id");
      expect(first.rows).toHaveLength(112);
      await client.query(seed);
      expect((await client.query("select id,module_id,slug,body from learning_activities where slug like 'curriculum-v1-%' order by id")).rows).toEqual(first.rows);
      expect((await client.query("select * from learning_activities where slug not like 'curriculum-v1-%' order by id")).rows).toEqual(legacy);
      expect((await client.query("select * from learner_module_progress order by profile_id,module_id")).rows).toEqual(progress);
      expect((await client.query("select count(*)::int as n from learning_modules where slug like 'curriculum-v1-%' and status <> 'draft'")).rows[0].n).toBe(0);

      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [learner.id]);
      await client.query("set local role authenticated");
      expect((await client.query("select id from learning_activities where slug like 'curriculum-v1-%'")).rows).toHaveLength(0);
      expect((await client.query("select id from learning_modules where slug like 'curriculum-v1-%'")).rows).toHaveLength(0);
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [operator.id]);
      await client.query("set local role authenticated");
      expect((await client.query("select id from learning_activities where slug like 'curriculum-v1-%'")).rows).toHaveLength(112);
      await client.query("reset role");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
