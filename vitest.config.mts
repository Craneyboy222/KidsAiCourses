import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Inline projects inherit the plugins and resolve settings declared here (Vitest 5).
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws outside a React Server environment; tests run in Node.
    alias: { "server-only": new URL("./tests/helpers/server-only-stub.ts", import.meta.url).pathname },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["tests/helpers/setup-env.ts", "tests/helpers/setup-dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/helpers/setup-env.ts"],
          globalSetup: ["tests/helpers/global-db.ts"],
          // One database is shared, so integration files run one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
