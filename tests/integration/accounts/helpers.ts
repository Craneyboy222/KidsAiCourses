import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { vi } from "vitest";
import { systemCtx } from "@/server/context";
import { metricCounter, session, user } from "@/server/db/schema";
import { clearSentEmails } from "@/server/email";
import type { Entitlement } from "@/server/services/entitlements";
import { setSetting } from "@/server/settings";
import { markLaunchReadyForDev } from "@/server/settings/launch-readiness";
import { importConsents } from "../../../scripts/import-consents";
import { db, resetDb } from "../../helpers/db";

/**
 * Shared set-up for the accounts integration tests.
 *
 * MOCKED CONTRACTS. `getEntitlementForFamily` (payments slice) and the catalogue (learning slice)
 * still throw "not implemented", so each test file replaces them with `vi.mock`. Everything else
 * is the real code against real Postgres.
 */

/** The plan the mocked payments slice reports. Tests change `seats` to exercise the limit. */
export const plan: { seats: number } = { seats: 2 };

export function mockedEntitlement(): Entitlement {
  return { planKey: "free", fullCatalogue: false, seats: plan.seats, coachCreditsPerLearnerPerMonth: 50, status: "none", periodKey: "2026-11" };
}

/** A fixed "now" well away from a month boundary, so ages do not flip while a test runs. */
export const NOW = new Date("2026-11-16T10:00:00Z");
export const daysFrom = (start: Date, days: number) => new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

/** A birth month and year that give exactly this age on `NOW` (birthdays count once the birth month is over). */
export function birthFor(age: number, now: Date = NOW): { birthYear: number; birthMonth: number } {
  // NOW is November: someone born in May has certainly had this year's birthday.
  return { birthYear: now.getUTCFullYear() - age, birthMonth: 5 };
}

/** Opens sign-up through the real launch-readiness gate. */
export async function openSignup(): Promise<void> {
  const seed = systemCtx("seed");
  await markLaunchReadyForDev(seed);
  await setSetting(seed, "site.signup_open", true);
}

/** Loads the five consent definitions from `content/consents`. */
export async function loadConsents(): Promise<void> {
  await importConsents(systemCtx("consents.import"));
}

/** Empty database, sign-up open, consent wording loaded, two seats on the plan, no emails waiting. */
export async function freshAccountsDb(options: { open?: boolean; consents?: boolean } = {}): Promise<void> {
  await resetDb();
  plan.seats = 2;
  clearSentEmails();
  vi.clearAllMocks();
  if (options.open !== false) await openSignup();
  if (options.consents !== false) await loadConsents();
}

/** How many rows a table holds. */
export async function countRows(table: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${table.replace(/"/g, "")}"`));
  return rows[0]?.n ?? 0;
}

/** The tables that could hold something about a child. Used to prove that a blocked sign-up wrote nothing. */
export const CHILD_TABLES = [
  "user",
  "learner_profile",
  "parent_link_request",
  "family_member",
  "account",
  "session",
  "invite_code",
  "consent_record",
  "audit_log",
  "notification",
  "rate_limit_bucket",
  "verification",
] as const;

export async function snapshot(tables: readonly string[] = CHILD_TABLES): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of tables) out[table] = await countRows(table);
  return out;
}

/** Today's total for an anonymous counter, summed over every day so the test does not depend on the date. */
export async function counterTotal(key: string): Promise<number> {
  const rows = await db.select({ count: metricCounter.count }).from(metricCounter).where(eq(metricCounter.key, key));
  return rows.reduce((sum, row) => sum + Number(row.count), 0);
}

/** A signed-in session row, as Better Auth would have written it. */
export async function addSession(userId: string): Promise<void> {
  await db.insert(session).values({ userId, token: `test-${randomUUID()}`, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
}

export async function sessionCount(userId: string): Promise<number> {
  return (await db.select({ id: session.id }).from(session).where(eq(session.userId, userId))).length;
}

export async function userRow(userId: string) {
  const rows = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  return rows[0];
}

/** Fails if a learner's hidden placeholder address appears anywhere in a value a service returned. */
export function expectNoPlaceholderEmail(value: unknown): void {
  const text = JSON.stringify(value) ?? "";
  if (/learner\.invalid/i.test(text)) throw new Error(`A service returned the learner placeholder email: ${text.slice(0, 300)}`);
}

/** The three required consents, ticked. */
export const REQUIRED_TICKED = { account_learning_data: true, ai_processing: true, third_party_tools: true } as const;
