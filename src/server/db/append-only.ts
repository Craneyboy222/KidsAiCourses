import { sql } from "drizzle-orm";
import type { Db, Tx } from "./client";

/** Tables protected by the `forbid_append_only_change` trigger (see `drizzle/0001_*.sql`). */
export const APPEND_ONLY_TABLES = ["consent_record", "credit_ledger", "audit_log"] as const;

/**
 * The ONLY way to update, delete or truncate rows in an append-only table. It exists for two
 * callers and nothing else: the nightly retention job (audit logs are kept for two years, and a
 * deleted learner's credit ledger is removed) and test clean-up.
 *
 * It opens a transaction and switches the trigger off for that transaction alone
 * (`SET LOCAL`), so the bypass can never leak to another request on the same connection.
 * Application services must never call this to "fix" a row: insert a correcting row instead.
 */
export async function withAppendOnlyMaintenance<T>(
  db: Db,
  reason: "retention" | "account_deletion" | "test_reset",
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.append_only_maintenance', ${reason}, true)`);
    return fn(tx);
  });
}
