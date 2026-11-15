import { sql } from "drizzle-orm";
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Column helpers shared by every schema file (spec Section 12 conventions).
 * Times are stored in UTC as `timestamptz` and shown in Europe/London by `@/lib/dates`.
 */

/** `id uuid primary key default gen_random_uuid()` */
export const id = () => uuid("id").primaryKey().defaultRandom();

/** A `timestamptz` column. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** `created_at` only: for append-only and event tables that are never updated. */
export const createdAt = () => ts("created_at").notNull().defaultNow();

/** `created_at` and `updated_at`. `updated_at` is set by the database clock on every Drizzle update. */
export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});

/** Case-insensitive text (needs the `citext` extension, created by `scripts/migrate.ts`). */
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

/** Postgres full-text search vector. Only ever written by a generated column. */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** An empty `text[]` default. */
export const emptyTextArray = sql`'{}'::text[]`;
/** An empty `uuid[]` default. */
export const emptyUuidArray = sql`'{}'::uuid[]`;
