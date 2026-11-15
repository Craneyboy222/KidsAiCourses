import { config } from "dotenv";
import { getEnv, resetEnvCache } from "@/env";
import { databaseName, dropEverything, runMigrations } from "@/server/db/migrate";

/**
 * Vitest global setup for the integration project: runs once, before any integration test file.
 * Loads `.env.test`, wipes `platform_test` and applies every migration, so each run starts from a
 * schema built only by the migrations in `./drizzle`.
 */
export default async function setup(): Promise<void> {
  config({ path: ".env.test", override: true, quiet: true });
  resetEnvCache();
  const env = getEnv();
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;

  // This drops every table. Only ever allow it against a database that is plainly for tests.
  const name = databaseName(url);
  if (env.APP_ENV !== "test" || !/test/i.test(name)) {
    throw new Error(
      `Refusing to reset "${name}": integration tests need APP_ENV=test and a database whose name contains "test".`,
    );
  }

  await dropEverything(url);
  await runMigrations(url);
}
