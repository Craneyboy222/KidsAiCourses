import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const shared = {
  plugins: [tsconfigPaths(), react()],
  resolve: { alias: { "server-only": new URL("./tests/helpers/server-only-stub.ts", import.meta.url).pathname } },
};

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["tests/helpers/setup-env.ts", "tests/helpers/setup-dom.ts"],
        },
      },
      {
        ...shared,
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
