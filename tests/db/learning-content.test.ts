import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asUser, createUser, pool } from "./helpers";

const migration = readFileSync("supabase/migrations/20260919000100_learning_content.sql", "utf8");

describe("reference learning content upgrade", () => {
  it("preserves operator-authored content and activity identities on replay", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: before } = await client.query(
        "select id, module_id, slug, requires_output, sort_order from learning_activities order by id",
      );
      const { rows: [activity] } = await client.query(
        `update learning_activities set body = 'Operator-authored content must survive this upgrade.'
         where id = (select a.id from learning_activities a join learning_modules m on m.id = a.module_id
                     where m.slug = 'module-ai-concepts' and a.slug = 'lesson') returning id`,
      );
      await client.query(migration);
      await client.query(migration);
      expect((await client.query("select body from learning_activities where id = $1", [activity.id])).rows[0].body)
        .toBe("Operator-authored content must survive this upgrade.");
      expect((await client.query(
        "select id, module_id, slug, requires_output, sort_order from learning_activities order by id",
      )).rows).toEqual(before);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("serves distinct lessons and practice through authenticated RLS", async () => {
    const learner = await createUser("learning-content");
    const rows = await asUser(learner.id, async (client) => (await client.query(
      `select a.body, a.slug, a.requires_output from learning_activities a
       join learning_modules m on m.id = a.module_id
       where m.slug in ('module-ai-concepts', 'module-ai-limitations', 'module-prompt-design',
         'module-ai-tool-workflow', 'module-data-interpretation', 'module-data-quality',
         'module-applied-ai-projects', 'module-ai-ethics')`,
    )).rows);
    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((row) => row.body)).size).toBe(24);
    expect(rows.filter((row) => row.slug === "lesson").every((row) => row.body.startsWith("Objective:"))).toBe(true);
    expect(rows.filter((row) => row.slug !== "lesson").every((row) => row.requires_output)).toBe(true);
  });
});
