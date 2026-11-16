// CONTRACT — owner: Coach slice. See _contract.ts. `getCreditBalance` and `grantCredits` keep the lead's signatures.
import { TZDate } from "@date-fns/tz";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { DISPLAY_TZ, londonDateKey } from "@/lib/dates";
import { spendLevel, type SpendLevel } from "@/server/ai/cost";
import { audit } from "@/server/audit";
import { assertCan, systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { creditBalance, creditLedger, creditPrice, familyMember, siteSetting, spendCounter, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { logError } from "@/server/log";
import { getSetting } from "@/server/settings/store";
import { getEntitlementForLearner } from "./entitlements";

/**
 * Coach credits: internal "AI energy" (spec 3.5 and Section 8).
 *
 * - Credits pay for Coach only. They are never used for third-party tools, and learners are never
 *   shown a price: only an energy level.
 * - `credit_ledger` is append-only: every grant, reservation, commit, release and expiry is a new
 *   row. `credit_balance` holds the running totals for one learner and one period, and is only
 *   ever changed under a row lock (`SELECT … FOR UPDATE`) in the same transaction as its ledger rows.
 *   A database check constraint (`reserved + spent + expired <= granted`) is the last line of defence.
 * - Periods come from the entitlement: the calendar month on Free (`2026-11`), or the subscription
 *   anniversary (`2026-11-15`). The allowance is granted lazily, the first time credits are used
 *   in a period. Whatever is left in an earlier period is expired then: nothing rolls over.
 * - Reservations are idempotent on a key, so a retried request holds credits once.
 */
export type CreditBalance = { balance: number; monthlyAllowance: number; periodKey: string; resetsAt: Date };

/** What the credit functions need to know about the learner's plan. A subset of `Entitlement`. */
export type CreditEntitlement = { coachCreditsPerLearnerPerMonth: number; periodKey: string };

export type ReserveResult =
  | { ok: true; reservationId: string; reserved: number; balance: CreditBalance }
  | { ok: false; reason: "insufficient"; balance: CreditBalance };

export const TUTOR_MESSAGE_PRICE_KEY = "tutor.message";

type BalanceRow = typeof creditBalance.$inferSelect;
type DbCtx = Pick<Ctx, "db" | "now">;

const available = (row: Pick<BalanceRow, "granted" | "reserved" | "spent" | "expired">): number => row.granted - row.reserved - row.spent - row.expired;

const londonMidnight = (year: number, monthIndex: number, day: number): Date => new Date(new TZDate(year, monthIndex, day, DISPLAY_TZ).getTime());

/**
 * Start and end of a credit period, in UK time. `2026-11` is the calendar month; `2026-11-15` is
 * a month from that anniversary (a 31st that does not exist next month ends on the last day).
 * An unrecognised key gets a 31-day window from `now`, so a new kind of plan still works.
 */
export function periodBounds(periodKey: string, now: Date): { start: Date; end: Date } {
  const month = periodKey.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const year = Number(month[1]);
    const index = Number(month[2]) - 1;
    return { start: londonMidnight(year, index, 1), end: londonMidnight(year, index + 1, 1) };
  }
  const day = periodKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const year = Number(day[1]);
    const index = Number(day[2]) - 1;
    const dom = Number(day[3]);
    const daysInNextMonth = new Date(Date.UTC(year, index + 2, 0)).getUTCDate();
    return { start: londonMidnight(year, index, dom), end: londonMidnight(year, index + 1, Math.min(dom, daysInNextMonth)) };
  }
  return { start: now, end: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000) };
}

const view = (row: BalanceRow, entitlement: CreditEntitlement): CreditBalance => ({
  balance: Math.max(0, available(row)),
  monthlyAllowance: Math.max(0, Math.floor(entitlement.coachCreditsPerLearnerPerMonth)),
  periodKey: row.periodKey,
  resetsAt: row.periodEnd,
});

async function familyIdOf(db: Db, learnerId: string): Promise<string | null> {
  const [row] = await db.select({ familyId: familyMember.familyId }).from(familyMember).where(eq(familyMember.userId, learnerId)).limit(1);
  return row?.familyId ?? null;
}

/**
 * Makes sure the learner has a balance row for the current period, granting the allowance the
 * first time, and returns that row LOCKED for the rest of the transaction. Earlier periods with
 * anything left are expired here: unused credits do not roll over.
 */
async function lockCurrentPeriod(tx: Db, now: Date, input: { learnerId: string; familyId: string | null; entitlement: CreditEntitlement }): Promise<BalanceRow> {
  const { learnerId, familyId, entitlement } = input;
  const periodKey = entitlement.periodKey;
  const allowance = Math.max(0, Math.floor(entitlement.coachCreditsPerLearnerPerMonth));
  const { start, end } = periodBounds(periodKey, now);

  const inserted = await tx
    .insert(creditBalance)
    .values({ learnerId, periodKey, periodStart: start, periodEnd: end, granted: allowance, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: [creditBalance.learnerId, creditBalance.periodKey] })
    .returning({ id: creditBalance.id });
  if (inserted.length > 0 && allowance > 0) {
    await tx
      .insert(creditLedger)
      .values({ learnerId, familyId, entryType: "grant", amount: allowance, periodKey, idempotencyKey: `grant:${learnerId}:${periodKey}`, reason: "Monthly Coach allowance", createdAt: now })
      .onConflictDoNothing({ target: creditLedger.idempotencyKey });
  }

  const [row] = await tx
    .select()
    .from(creditBalance)
    .where(and(eq(creditBalance.learnerId, learnerId), eq(creditBalance.periodKey, periodKey)))
    .limit(1)
    .for("update");
  if (!row) throw new AppError("internal", "Something went wrong with Coach energy. Try again in a moment.", { detail: { learnerId, periodKey } });

  // No roll-over: whatever is still free in any other period is written off now.
  const stale = await tx
    .select()
    .from(creditBalance)
    .where(and(eq(creditBalance.learnerId, learnerId), ne(creditBalance.periodKey, periodKey), sql`${creditBalance.granted} - ${creditBalance.reserved} - ${creditBalance.spent} - ${creditBalance.expired} > 0`))
    .for("update");
  for (const old of stale) {
    const left = available(old);
    if (left <= 0) continue;
    await tx
      .insert(creditLedger)
      .values({ learnerId, familyId, entryType: "expire", amount: left, periodKey: old.periodKey, idempotencyKey: `expire:${learnerId}:${old.periodKey}:${old.expired}`, reason: "Unused credits do not roll over", createdAt: now })
      .onConflictDoNothing({ target: creditLedger.idempotencyKey });
    await tx.update(creditBalance).set({ expired: old.expired + left, updatedAt: now }).where(eq(creditBalance.id, old.id));
  }
  return row;
}

/**
 * Coach credits for the current period. Unused credits do not roll over (spec 3.5).
 * Reading never writes: before the first use in a period the balance is the full allowance.
 * A learner may read their own; a parent, their child's.
 */
export async function getCreditBalance(ctx: Ctx, learnerId: string): Promise<CreditBalance> {
  const familyId = await familyIdOf(ctx.db, learnerId);
  assertCan(ctx.actor, "learner.coach.summary.read", { learnerId, familyId });
  const entitlement = await getEntitlementForLearner(ctx, learnerId);
  return readCreditBalance(ctx, learnerId, entitlement);
}

/** The balance for a known entitlement, without an authorisation check. For the Coach pipeline. */
export async function readCreditBalance(ctx: DbCtx, learnerId: string, entitlement: CreditEntitlement): Promise<CreditBalance> {
  const [row] = await ctx.db
    .select()
    .from(creditBalance)
    .where(and(eq(creditBalance.learnerId, learnerId), eq(creditBalance.periodKey, entitlement.periodKey)))
    .limit(1);
  if (row) return view(row, entitlement);
  const allowance = Math.max(0, Math.floor(entitlement.coachCreditsPerLearnerPerMonth));
  return { balance: allowance, monthlyAllowance: allowance, periodKey: entitlement.periodKey, resetsAt: periodBounds(entitlement.periodKey, ctx.now).end };
}

/**
 * Adds credits through the append-only ledger (promo credit grants, support goodwill).
 * Idempotent on `idempotencyKey`. Staff with support or admin rights, or a system job.
 */
export async function grantCredits(ctx: Ctx, input: { learnerId: string; amount: number; reason: string; idempotencyKey: string }): Promise<CreditBalance> {
  assertCan(ctx.actor, "support.ticket.manage");
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 100_000) {
    throw new AppError("invalid_input", "Enter a whole number of credits, at least 1.");
  }
  const entitlement = await getEntitlementForLearner(ctx, input.learnerId);
  const familyId = await familyIdOf(ctx.db, input.learnerId);
  return ctx.db.transaction(async (tx) => {
    const row = await lockCurrentPeriod(tx, ctx.now, { learnerId: input.learnerId, familyId, entitlement });
    const written = await tx
      .insert(creditLedger)
      .values({ learnerId: input.learnerId, familyId, entryType: "grant", amount: input.amount, periodKey: row.periodKey, idempotencyKey: `grant:${input.idempotencyKey}`, reason: input.reason.slice(0, 300), createdAt: ctx.now })
      .onConflictDoNothing({ target: creditLedger.idempotencyKey })
      .returning({ id: creditLedger.id });
    if (written.length === 0) return view(row, entitlement); // Already granted with this key.
    const [updated] = await tx.update(creditBalance).set({ granted: row.granted + input.amount, updatedAt: ctx.now }).where(eq(creditBalance.id, row.id)).returning();
    await audit(ctx, { action: "credits.grant", targetType: "user", targetId: input.learnerId, reason: input.reason.slice(0, 300), meta: { amount: input.amount, periodKey: row.periodKey } }, tx);
    return view(updated ?? row, entitlement);
  });
}

/**
 * Holds `amount` credits before a model call. Returns `ok: false` when there are not enough.
 * Idempotent: the same `idempotencyKey` returns the first reservation and holds nothing more.
 * Parallel calls queue on the balance row's lock, so the total held can never exceed what is there.
 */
export async function reserveCredits(
  ctx: DbCtx,
  input: { learnerId: string; familyId: string | null; amount: number; idempotencyKey: string; entitlement: CreditEntitlement },
): Promise<ReserveResult> {
  if (!Number.isInteger(input.amount) || input.amount < 1) throw new Error("reserveCredits: amount must be a whole number of at least 1");
  const key = `reserve:${input.idempotencyKey}`;
  return ctx.db.transaction(async (tx) => {
    const row = await lockCurrentPeriod(tx, ctx.now, input);
    const [existing] = await tx.select().from(creditLedger).where(eq(creditLedger.idempotencyKey, key)).limit(1);
    if (existing) {
      if (existing.learnerId !== input.learnerId || existing.entryType !== "reserve") {
        throw new AppError("conflict", "That request was already used. Send your message again.", { detail: { key } });
      }
      return { ok: true, reservationId: existing.id, reserved: existing.amount, balance: view(row, input.entitlement) };
    }
    if (available(row) < input.amount) return { ok: false, reason: "insufficient", balance: view(row, input.entitlement) };

    const [entry] = await tx
      .insert(creditLedger)
      .values({ learnerId: input.learnerId, familyId: input.familyId, entryType: "reserve", amount: input.amount, periodKey: row.periodKey, idempotencyKey: key, createdAt: ctx.now })
      .returning({ id: creditLedger.id });
    if (!entry) throw new Error("reserveCredits: the ledger insert returned nothing");
    const [updated] = await tx.update(creditBalance).set({ reserved: row.reserved + input.amount, updatedAt: ctx.now }).where(eq(creditBalance.id, row.id)).returning();
    return { ok: true, reservationId: entry.id, reserved: input.amount, balance: view(updated ?? row, input.entitlement) };
  });
}

/** Settles a reservation: `spend` credits are spent (0 to release everything) and the rest go back. Idempotent. */
async function settleReservation(ctx: DbCtx, input: { reservationId: string; spend: number; aiRequestId?: string | null; reason?: string }): Promise<{ spent: number; released: number }> {
  return ctx.db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.id, input.reservationId), eq(creditLedger.entryType, "reserve")))
      .limit(1);
    if (!reservation) throw new AppError("not_found", "That energy hold could not be found.", { detail: { reservationId: input.reservationId } });

    // Lock the balance first: a commit and a release racing on one reservation are then settled one after the other.
    const [row] = await tx
      .select()
      .from(creditBalance)
      .where(and(eq(creditBalance.learnerId, reservation.learnerId), eq(creditBalance.periodKey, reservation.periodKey)))
      .limit(1)
      .for("update");
    if (!row) throw new Error("settleReservation: the balance row for a reservation is missing");

    const settled = await tx
      .select({ entryType: creditLedger.entryType, amount: creditLedger.amount })
      .from(creditLedger)
      .where(and(eq(creditLedger.reservationId, reservation.id), inArray(creditLedger.entryType, ["commit", "release"])));
    if (settled.length > 0) {
      return {
        spent: settled.filter((s) => s.entryType === "commit").reduce((n, s) => n + s.amount, 0),
        released: settled.filter((s) => s.entryType === "release").reduce((n, s) => n + s.amount, 0),
      };
    }

    const spend = Math.max(0, Math.min(reservation.amount, Math.floor(input.spend)));
    const released = reservation.amount - spend;
    const base = { learnerId: reservation.learnerId, familyId: reservation.familyId, periodKey: reservation.periodKey, reservationId: reservation.id, aiRequestId: input.aiRequestId ?? null, createdAt: ctx.now };
    if (spend > 0) await tx.insert(creditLedger).values({ ...base, entryType: "commit", amount: spend, idempotencyKey: `commit:${reservation.id}` });
    if (released > 0) {
      await tx.insert(creditLedger).values({ ...base, entryType: "release", amount: released, idempotencyKey: `release:${reservation.id}`, reason: input.reason?.slice(0, 200) ?? null });
    }
    await tx
      .update(creditBalance)
      .set({ reserved: Math.max(0, row.reserved - reservation.amount), spent: row.spent + spend, updatedAt: ctx.now })
      .where(eq(creditBalance.id, row.id));
    return { spent: spend, released };
  });
}

/** Spends `amount` of a reservation (never more than was held) and releases the rest. */
export async function commitCredits(ctx: DbCtx, input: { reservationId: string; amount: number; aiRequestId?: string | null }): Promise<{ spent: number; released: number }> {
  return settleReservation(ctx, { reservationId: input.reservationId, spend: input.amount, aiRequestId: input.aiRequestId });
}

/** Gives a whole reservation back: the reply was refused, blocked or failed. */
export async function releaseCredits(ctx: DbCtx, input: { reservationId: string; reason?: string }): Promise<{ spent: number; released: number }> {
  return settleReservation(ctx, { reservationId: input.reservationId, spend: 0, reason: input.reason });
}

/** The least a tutor message costs, from `credit_price` (`tutor.message`). 1 when unset. */
export async function getTutorMessagePrice(ctx: Pick<Ctx, "db">): Promise<number> {
  const [row] = await ctx.db
    .select({ credits: creditPrice.credits })
    .from(creditPrice)
    .where(and(eq(creditPrice.key, TUTOR_MESSAGE_PRICE_KEY), eq(creditPrice.active, true)))
    .limit(1);
  return row ? Math.max(0, row.credits) : 1;
}

// ───────────────────────────── Daily spend cap ─────────────────────────────

export type SpendResult = { day: string; totalMillipence: number; level: SpendLevel; alertedNow: boolean; trippedNow: boolean };
export type SpendNotifier = (ctx: DbCtx, event: { kind: "alert" | "tripped"; day: string; totalMillipence: number; capPence: number }) => Promise<void>;

const pounds = (millipence: number): string => `£${(millipence / 100_000).toFixed(2)}`;

/** Tells admins through the notifications service. Imported lazily so that this module stays light. */
const notifyAdmins: SpendNotifier = async (ctx, event) => {
  const { notifyStaffWithRole } = await import("@/server/notifications");
  const tripped = event.kind === "tripped";
  await notifyStaffWithRole(ctx, ["admin", "super_admin"], {
    type: tripped ? "coach.spend_cap_tripped" : "coach.spend_cap_alert",
    title: tripped ? "Coach is on an AI break: the daily spend cap was reached" : "Coach has used 80% of today's AI spend cap",
    body: tripped
      ? `AI spend today is ${pounds(event.totalMillipence)} against a cap of ${pounds(event.capPence * 1000)}. The Coach kill switch has tripped automatically. Learners see "AI break — back soon"; steps and hints still work. Turn the switch off in Studio when you are ready.`
      : `AI spend today is ${pounds(event.totalMillipence)} against a cap of ${pounds(event.capPence * 1000)}. At 100% the Coach kill switch trips automatically.`,
    href: "/studio/ai",
    urgent: tripped,
    dedupeKey: `coach-spend-${event.kind}:${event.day}`,
  });
};

/**
 * Adds one model call's cost to today's totals (UK date): the feature's own row and the global
 * `all` row. Against `coach.daily_spend_cap_pence`: at 80% admins are alerted, once per day; at
 * 100% the `coach.kill_switch` setting is turned on automatically ("AI break — back soon").
 * Non-AI steps are unaffected. Used by Coach and by course drafting, which share the cap.
 */
export async function recordAiSpend(ctx: DbCtx, input: { feature: string; costMillipence: number }, notify: SpendNotifier = notifyAdmins): Promise<SpendResult> {
  const cost = Math.max(0, Math.ceil(input.costMillipence));
  const day = londonDateKey(ctx.now);
  const capPence = await getSetting(ctx, "coach.daily_spend_cap_pence");

  const outcome = await ctx.db.transaction(async (tx) => {
    const upsert = (feature: string) =>
      tx
        .insert(spendCounter)
        .values({ day, feature, costMillipence: cost, requestCount: 1, createdAt: ctx.now, updatedAt: ctx.now })
        .onConflictDoUpdate({
          target: [spendCounter.day, spendCounter.feature],
          set: { costMillipence: sql`${spendCounter.costMillipence} + ${cost}`, requestCount: sql`${spendCounter.requestCount} + 1`, updatedAt: ctx.now },
        })
        .returning();
    if (input.feature !== "all") await upsert(input.feature);
    // The upsert holds the row's lock until commit, so parallel requests see each other's totals.
    const [all] = await upsert("all");
    if (!all) throw new Error("recordAiSpend: the spend counter upsert returned nothing");

    const level = spendLevel(all.costMillipence, capPence);
    const alertedNow = level !== "ok" && all.alertedAt === null;
    const trippedNow = level === "tripped" && all.trippedAt === null;
    if (alertedNow || trippedNow) {
      await tx
        .update(spendCounter)
        .set({ ...(alertedNow ? { alertedAt: ctx.now } : {}), ...(trippedNow ? { trippedAt: ctx.now } : {}), updatedAt: ctx.now })
        .where(eq(spendCounter.id, all.id));
    }
    if (trippedNow) {
      await tx
        .insert(siteSetting)
        .values({ key: "coach.kill_switch", value: true, updatedBy: null, updatedAt: ctx.now })
        .onConflictDoUpdate({ target: siteSetting.key, set: { value: true, updatedBy: null, updatedAt: ctx.now } });
      // Recorded as the system's action, not the action of whoever sent the message that tipped it.
      await audit(
        { db: tx, now: ctx.now, actor: systemActor("coach.spend_cap"), requestId: `spend-cap:${day}` },
        { action: "setting.update", targetType: "site_setting", targetId: "coach.kill_switch", reason: "Daily AI spend cap reached", meta: { to: true, day, totalMillipence: all.costMillipence, capPence } },
        tx,
      );
    }
    return { day, totalMillipence: all.costMillipence, level, alertedNow, trippedNow };
  });

  // Alerts go out after the totals are safely committed. A failed alert never fails the request.
  for (const kind of [...(outcome.alertedNow && !outcome.trippedNow ? (["alert"] as const) : []), ...(outcome.trippedNow ? (["tripped"] as const) : [])]) {
    await notify(ctx, { kind, day, totalMillipence: outcome.totalMillipence, capPence }).catch((error: unknown) => logError("coach.spend_cap.notify_failed", error, { kind, day }));
  }
  return outcome;
}

/**
 * For a daily job: ends an AI break that the spend cap started on an earlier day. A switch that a
 * person turned on (it has an `updated_by`) is left alone. Returns true when it was turned off.
 */
export async function endSpendCapBreak(ctx: Ctx): Promise<boolean> {
  const today = londonDateKey(ctx.now);
  return ctx.db.transaction(async (tx) => {
    const [setting] = await tx.select().from(siteSetting).where(eq(siteSetting.key, "coach.kill_switch")).limit(1).for("update");
    if (!setting || setting.value !== true || setting.updatedBy !== null) return false;
    const [lastTrip] = await tx
      .select({ day: spendCounter.day })
      .from(spendCounter)
      .where(and(eq(spendCounter.feature, "all"), isNotNull(spendCounter.trippedAt)))
      .orderBy(desc(spendCounter.day))
      .limit(1);
    if (!lastTrip || lastTrip.day >= today) return false;
    await tx.update(siteSetting).set({ value: false, updatedAt: ctx.now }).where(eq(siteSetting.key, "coach.kill_switch"));
    await audit(ctx, { action: "setting.update", targetType: "site_setting", targetId: "coach.kill_switch", reason: "New day: the spend-cap AI break has ended", meta: { to: false, trippedOn: lastTrip.day } }, tx);
    return true;
  });
}
