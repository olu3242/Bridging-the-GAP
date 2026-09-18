import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // The db project shares one Postgres cluster: policies, triggers and seeded
    // rows are global state, so suites run one file at a time.
    fileParallelism: false,
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "domain",
          environment: "node",
          include: ["tests/domain/**/*.test.ts"],
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          setupFiles: ["tests/db/setup.ts"],
          testTimeout: 20000,
        },
      },
    ],
  },
});
