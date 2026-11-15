/**
 * `pnpm db:migrate` — creates the `citext` and `pgcrypto` extensions, then applies every pending
 * migration in `./drizzle`.
 *
 * Loads `.env.local` unless `DOTENV_PATH` names another file
 * (e.g. `DOTENV_PATH=.env.test pnpm db:migrate`).
 */
import { config } from "dotenv";
import { env } from "@/env";
import { databaseName, runMigrations } from "@/server/db/migrate";

// DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });

async function main(): Promise<void> {
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  const started = Date.now();
  await runMigrations(url);
  console.info(`Migrations applied to "${databaseName(url)}" in ${Date.now() - started} ms.`);
}

main().catch((error: unknown) => {
  console.error("Migration failed:", describe(error));
  process.exit(1);
});

/** The error and its cause: Drizzle wraps the Postgres message that says what actually went wrong. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `\n  Cause: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}
