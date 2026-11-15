import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Migration helpers shared by `scripts/migrate.ts`, `scripts/reset.ts` and the integration-test
 * global setup. They take the connection string as an argument and open their own single
 * connection, so they never touch the app's pool.
 */

const MIGRATIONS_FOLDER = "./drizzle";

function connect(url: string) {
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Creates the extensions the schema needs, then applies every pending migration in `./drizzle`. */
export async function runMigrations(
  url: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const sql = connect(url);
  try {
    // `citext` for case-insensitive usernames and codes; `pgcrypto` for digest() in SQL.
    await sql`CREATE EXTENSION IF NOT EXISTS citext`;
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Drops everything: the `public` schema and Drizzle's migration journal. Callers must refuse to
 * run this against production (see `scripts/reset.ts`).
 */
export async function dropEverything(url: string): Promise<void> {
  const sql = connect(url);
  try {
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await sql`CREATE SCHEMA public`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The database name in a connection string, for log lines. Never log the full URL: it holds the password. */
export function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "") || "(default)";
  } catch {
    return "(unparseable)";
  }
}
