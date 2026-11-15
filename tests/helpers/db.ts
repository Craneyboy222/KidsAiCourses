import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ANONYMOUS, type Actor } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { withAppendOnlyMaintenance } from "@/server/db/append-only";
import { closeDb, db } from "@/server/db/client";

export { closeDb, db };

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Every table in `public`, ordered so that a table always comes before the tables it references
 * with a CASCADE or RESTRICT foreign key (children first). Emptying them in this order never trips
 * a constraint. SET NULL keys cannot block a delete, so they are ignored, which is also what breaks
 * the deliberate loops such as `course` ↔ `course_version`.
 *
 * `null` means "use TRUNCATE instead": there is a loop of blocking keys, or a sequence exists that
 * RESTART IDENTITY would need to reset. Worked out once per test file.
 */
let deletionOrder: string[] | null | undefined;

async function loadDeletionOrder(): Promise<string[] | null> {
  if (deletionOrder !== undefined) return deletionOrder;

  const sequences = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pg_sequences where schemaname = 'public'`,
  );
  if ((sequences[0]?.n ?? 0) > 0) return (deletionOrder = null);

  const tableRows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const tables = Array.from(tableRows, (r) => r.tablename);

  const edgeRows = await db.execute<{ child: string; parent: string }>(sql`
    select child.relname as child, parent.relname as parent
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public' and c.confdeltype <> 'n' and c.conrelid <> c.confrelid`);

  // parent → the children that must be emptied first
  const waitingOn = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of edgeRows) waitingOn.get(parent)?.add(child);

  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < tables.length) {
    const ready = tables.filter(
      (t) => !done.has(t) && [...(waitingOn.get(t) ?? [])].every((child) => done.has(child)),
    );
    if (ready.length === 0) return (deletionOrder = null);
    for (const t of ready) {
      done.add(t);
      ordered.push(t);
    }
  }
  return (deletionOrder = ordered);
}

/** `TRUNCATE … RESTART IDENTITY CASCADE` on every table. Always correct, but slow with 90 tables. */
async function truncateEverything(): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const tables = Array.from(rows, (r) => quote(r.tablename)).join(", ");
  if (!tables) return;
  await withAppendOnlyMaintenance(db, "test_reset", async (tx) => {
    await tx.execute(sql.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`));
  });
}

/**
 * Empties every table. Call it in `beforeEach`.
 *
 * `TRUNCATE … RESTART IDENTITY CASCADE` across 90 tables takes most of a second, which adds up
 * over hundreds of tests. So the usual path finds the few tables a test actually wrote to and
 * deletes from just those, children first: a few milliseconds, and the same end state because no
 * table has a sequence to restart. It falls back to the TRUNCATE whenever that is not safe or the
 * delete fails.
 *
 * The append-only tables (`consent_record`, `credit_ledger`, `audit_log`) refuse DELETE and
 * TRUNCATE, so both paths run inside the one sanctioned bypass,
 * `withAppendOnlyMaintenance(…, "test_reset")`, which lasts only for that transaction.
 */
export async function resetDb(): Promise<void> {
  const order = await loadDeletionOrder();
  if (!order) return truncateEverything();

  try {
    await withAppendOnlyMaintenance(db, "test_reset", async (tx) => {
      const probe = order
        .map((t) => `select '${t.replace(/'/g, "''")}' as tablename where exists (select 1 from ${quote(t)})`)
        .join(" union all ");
      const rows = await tx.execute<{ tablename: string }>(sql.raw(probe));
      const nonEmpty = new Set(Array.from(rows, (r) => r.tablename));
      for (const table of order) {
        if (nonEmpty.has(table)) await tx.execute(sql.raw(`DELETE FROM ${quote(table)}`));
      }
    });
  } catch {
    await truncateEverything();
  }
}

/**
 * A request context for calling services directly. Anonymous unless an actor is given.
 * The clock is the real one by default, so it agrees with database defaults and with sessions
 * made by Better Auth; pass `{ now }` to pin it when a test depends on the date.
 *
 *   const { actor } = await createLearner({ age: 14, familyId });
 *   const ctx = testCtx(actor);
 *   const pinned = testCtx(actor, { now: new Date("2027-01-01T09:00:00Z") });
 */
export function testCtx<A extends Actor = Actor>(actor?: A, overrides: Partial<Ctx> = {}): Ctx<A> {
  return {
    db,
    now: new Date(),
    requestId: `test-${randomUUID()}`,
    ip: "203.0.113.10",
    ...overrides,
    actor: (actor ?? ANONYMOUS) as A,
  };
}
