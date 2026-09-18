import { afterAll, beforeAll } from "vitest";
import { DATABASE_URL, pool, sql } from "./helpers";

beforeAll(async () => {
  try {
    await sql("select 1");
  } catch (error) {
    throw new Error(
      `Cannot reach the certification database at ${DATABASE_URL}. ` +
        `Run "npm run db:local:up" first. Original error: ${(error as Error).message}`,
    );
  }
});

afterAll(async () => {
  await pool.end();
});
