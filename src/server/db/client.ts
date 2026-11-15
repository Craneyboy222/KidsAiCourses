import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

export type Schema = typeof schema;

/** The root client: can open transactions and owns the connection pool. */
export type RootDb = PostgresJsDatabase<Schema> & { $client: postgres.Sql };

/** A transaction handle, as passed to the callback of `db.transaction(async (tx) => …)`. */
export type Tx = PgTransaction<PostgresJsQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/**
 * What services accept as `ctx.db`: the root client or a transaction. Both can query, and both can
 * call `.transaction()` (inside a transaction that creates a savepoint).
 */
export type Db = PgDatabase<PostgresJsQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** Kept on `globalThis` so that dev hot reload reuses one pool instead of leaking connections. */
const globalForDb = globalThis as typeof globalThis & { __platformDb?: RootDb };

function create(): RootDb {
  const client = postgres(env.DATABASE_URL, {
    // Serverless functions each hold a small pool; tests and scripts need very few connections.
    max: env.NODE_ENV === "production" ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Silence NOTICE chatter (e.g. "extension already exists").
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

/** The lazily created singleton. Nothing connects until the first query. */
export function getDb(): RootDb {
  return (globalForDb.__platformDb ??= create());
}

/**
 * `db` is a thin proxy over `getDb()` so that importing this module never reads the environment
 * or opens a connection (important for `next build`).
 */
export const db: RootDb = new Proxy({} as RootDb, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
  has(_target, prop) {
    return Reflect.has(getDb(), prop);
  },
});

/** Closes the pool. For scripts and test teardown only. */
export async function closeDb(): Promise<void> {
  const existing = globalForDb.__platformDb;
  if (!existing) return;
  globalForDb.__platformDb = undefined;
  await existing.$client.end({ timeout: 5 });
}
