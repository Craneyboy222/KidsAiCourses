/**
 * `pnpm db:reset` — drops and recreates the `public` schema, then applies every migration.
 * EVERYTHING in the database is destroyed. Refuses to run when `APP_ENV=production`.
 *
 * Loads `.env.local` unless `DOTENV_PATH` names another file.
 */
import { config } from "dotenv";
import { env } from "@/env";
import { databaseName, dropEverything, runMigrations } from "@/server/db/migrate";

// DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });

async function main(): Promise<void> {
  if (env.APP_ENV === "production" || env.NODE_ENV === "production") {
    throw new Error("db:reset refuses to run in production. It would delete every family's data.");
  }
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  const started = Date.now();
  await dropEverything(url);
  await runMigrations(url);
  console.info(`Database "${databaseName(url)}" reset and migrated in ${Date.now() - started} ms.`);
}

main().catch((error: unknown) => {
  console.error("Reset failed:", describe(error));
  process.exit(1);
});

/** The error and its cause: Drizzle wraps the Postgres message that says what actually went wrong. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `\n  Cause: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}
