/**
 * Coach credits ("AI energy") on real Postgres (spec 3.5 and Section 8).
 *
 * Append-only ledger, balance under a row lock, idempotent reservations, a lazy monthly grant
 * from the entitlement's period key, no roll-over, and — the point of the row lock — parallel
 * requests that can never overspend. Then the daily spend cap: an admin alert at 80% and the
 * kill switch at 100%.
 *
 * `entitlements.getEntitlementForLearner` is mocked (the payments slice has not written it yet);
 * `usage` and `safeguarding` are mocked for the pipeline tests at the end, for the same reason.
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toEnergyView } from "@/server/ai/deps";
import { COACH_COPY } from "@/server/ai/proxy";
import { auditLog, creditBalance, creditLedger, creditPrice, notification, siteSetting, spendCounter } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  commitCredits,
  endSpendCapBreak,
  getCreditBalance,
  getTutorMessagePrice,
  grantCredits,
  periodBounds,
  readCreditBalance,
  recordAiSpend,
  releaseCredits,
  reserveCredits,
  type CreditEntitlement,
  type ReserveResult,
  type SpendNotifier,
} from "@/server/services/credits";
import { getSetting } from "@/server/settings";
import { db, testCtx } from "../../helpers/db";
import { createStaff } from "../../helpers/factories";
import { NOW, PERIOD, ask, availableFor, balanceFor, coachCtx, createCoachLearner, harness, ledgerFor, mocks, resetBetweenTests, setCoachSetting, setUpWorld, type World } from "./helpers";

vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<object>()), getEntitlementForLearner: vi.fn() }));
vi.mock("@/server/services/usage", async (original) => ({ ...(await original<object>()), checkLearningAllowed: vi.fn() }));
vi.mock("@/server/services/safeguarding", async (original) => ({ ...(await original<object>()), openSafeguardingCase: vi.fn() }));

const FREE: CreditEntitlement = { coachCreditsPerLearnerPerMonth: 50, periodKey: PERIOD };
const dbCtx = (now: Date = NOW) => ({ db, now });
let keyCounter = 0;
const key = () => `test-${(keyCounter += 1)}-${Math.random().toString(36).slice(2)}`;

let world: World;
beforeAll(async () => {
  world = await setUpWorld();
});
beforeEach(resetBetweenTests);

const reserve = (learnerId: string, familyId: string, amount: number, entitlement: CreditEntitlement = FREE, idempotencyKey: string = key(), now: Date = NOW) =>
  reserveCredits(dbCtx(now), { learnerId, familyId, amount, idempotencyKey, entitlement });
const held = (result: ReserveResult): string => {
  if (!result.ok) throw new Error("expected the reservation to succeed");
  return result.reservationId;
};

describe("periods", () => {
  it("a calendar-month key runs from the first of the month to the first of the next, in UK time", () => {
    expect(periodBounds("2026-11", NOW)).toEqual({ start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") });
    // British Summer Time: midnight in London is 23:00 UTC the day before.
    expect(periodBounds("2026-06", NOW)).toEqual({ start: new Date("2026-05-31T23:00:00Z"), end: new Date("2026-06-30T23:00:00Z") });
    expect(periodBounds("2026-12", NOW).end).toEqual(new Date("2027-01-01T00:00:00Z"));
  });

  it("an anniversary key runs for a month from that day, ending on the last day when the next month is shorter", () => {
    expect(periodBounds("2026-11-15", NOW)).toEqual({ start: new Date("2026-11-15T00:00:00Z"), end: new Date("2026-12-15T00:00:00Z") });
    expect(periodBounds("2027-01-31", NOW).end).toEqual(new Date("2027-02-28T00:00:00Z"));
  });
});

describe("the lazy monthly grant", () => {
  it("reading never writes: before the first use the balance is the whole allowance", async () => {
    const learner = await createCoachLearner(world);
    const balance = await getCreditBalance(coachCtx(learner.actor), learner.actor.userId);
    expect(balance).toEqual({ balance: 50, monthlyAllowance: 50, periodKey: PERIOD, resetsAt: new Date("2026-12-01T00:00:00Z") });
    expect(await balanceFor(learner.actor.userId)).toBeNull();
    expect(await ledgerFor(learner.actor.userId)).toHaveLength(0);
  });

  it("grants the allowance on first use in a period, once, from the entitlement's period key", async () => {
    const learner = await createCoachLearner(world);
    const first = await reserve(learner.actor.userId, learner.familyId, 2);
    expect(first).toMatchObject({ ok: true, reserved: 2, replayed: false, balance: { balance: 48, monthlyAllowance: 50, periodKey: PERIOD } });
    await reserve(learner.actor.userId, learner.familyId, 1);

    const ledger = await ledgerFor(learner.actor.userId);
    expect(ledger.filter((row) => row.entryType === "grant")).toHaveLength(1);
    expect(ledger.find((row) => row.entryType === "grant")).toMatchObject({ amount: 50, periodKey: PERIOD, familyId: learner.familyId });
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 50, reserved: 3, spent: 0, periodStart: new Date("2026-11-01T00:00:00Z"), periodEnd: new Date("2026-12-01T00:00:00Z") });
  });

  it("a Family plan's anniversary period has its own allowance and reset date", async () => {
    const learner = await createCoachLearner(world);
    const family: CreditEntitlement = { coachCreditsPerLearnerPerMonth: 200, periodKey: "2026-11-15" };
    const result = await reserve(learner.actor.userId, learner.familyId, 1, family);
    expect(result).toMatchObject({ ok: true, balance: { balance: 199, monthlyAllowance: 200, periodKey: "2026-11-15", resetsAt: new Date("2026-12-15T00:00:00Z") } });
  });

  it("when parallel first requests race, the allowance is still granted exactly once", async () => {
    const learner = await createCoachLearner(world);
    const results = await Promise.all(Array.from({ length: 12 }, () => reserve(learner.actor.userId, learner.familyId, 1)));
    expect(results.every((result) => result.ok)).toBe(true);
    const ledger = await ledgerFor(learner.actor.userId);
    expect(ledger.filter((row) => row.entryType === "grant")).toHaveLength(1);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 50, reserved: 12 });
  });
});

describe("reserve, commit and release", () => {
  it("commit spends what was used and gives the rest back; release gives everything back", async () => {
    const learner = await createCoachLearner(world);
    const a = held(await reserve(learner.actor.userId, learner.familyId, 5));
    const b = held(await reserve(learner.actor.userId, learner.familyId, 4));
    expect(await availableFor(learner.actor.userId)).toBe(41);

    expect(await commitCredits(dbCtx(), { reservationId: a, amount: 2, aiRequestId: null })).toEqual({ spent: 2, released: 3 });
    expect(await releaseCredits(dbCtx(), { reservationId: b, reason: "blocked_output" })).toEqual({ spent: 0, released: 4 });
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 50, reserved: 0, spent: 2, expired: 0 });
    expect(await availableFor(learner.actor.userId)).toBe(48);

    const ledger = await ledgerFor(learner.actor.userId);
    expect(ledger.map((row) => `${row.entryType}:${row.amount}`).sort()).toEqual(["commit:2", "grant:50", "release:3", "release:4", "reserve:4", "reserve:5"]);
    expect(ledger.filter((row) => row.reservationId === a).map((row) => row.entryType).sort()).toEqual(["commit", "release"]);
    // The running balance always equals what the ledger adds up to.
    const sum = (type: string) => ledger.filter((row) => row.entryType === type).reduce((n, row) => n + row.amount, 0);
    expect(sum("grant") - sum("commit") - (sum("reserve") - sum("commit") - sum("release"))).toBe(48);
  });

  it("never spends more than was held, and settles a reservation only once", async () => {
    const learner = await createCoachLearner(world);
    const id = held(await reserve(learner.actor.userId, learner.familyId, 3));
    expect(await commitCredits(dbCtx(), { reservationId: id, amount: 99 })).toEqual({ spent: 3, released: 0 });
    // Settling again, either way, changes nothing.
    expect(await commitCredits(dbCtx(), { reservationId: id, amount: 1 })).toEqual({ spent: 3, released: 0 });
    expect(await releaseCredits(dbCtx(), { reservationId: id })).toEqual({ spent: 3, released: 0 });
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ reserved: 0, spent: 3 });
    expect((await ledgerFor(learner.actor.userId)).filter((row) => row.reservationId === id)).toHaveLength(1);
  });

  it("a commit and a release racing on one reservation settle it once", async () => {
    const learner = await createCoachLearner(world);
    const id = held(await reserve(learner.actor.userId, learner.familyId, 4));
    const outcomes = await Promise.all([commitCredits(dbCtx(), { reservationId: id, amount: 4 }), releaseCredits(dbCtx(), { reservationId: id }), commitCredits(dbCtx(), { reservationId: id, amount: 4 })]);
    expect(new Set(outcomes.map((o) => JSON.stringify(o))).size).toBe(1);
    const row = await balanceFor(learner.actor.userId);
    expect(row?.reserved).toBe(0);
    expect((row?.spent ?? 0) + (await availableFor(learner.actor.userId) ?? 0)).toBe(50);
    expect((await ledgerFor(learner.actor.userId)).filter((entry) => entry.reservationId === id)).toHaveLength(1);
  });

  it("is idempotent on the key: a second reservation with the same key holds nothing more and is marked as a replay", async () => {
    const learner = await createCoachLearner(world);
    const first = await reserve(learner.actor.userId, learner.familyId, 3, FREE, "same");
    const second = await reserve(learner.actor.userId, learner.familyId, 3, FREE, "same");
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true, reservationId: held(first), reserved: 3 });
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ reserved: 3 });

    const other = await createCoachLearner(world);
    await expect(reserve(other.actor.userId, other.familyId, 1, FREE, "same")).rejects.toMatchObject({ code: "conflict" });
  });

  it("says no when there is not enough, and holds nothing", async () => {
    const learner = await createCoachLearner(world);
    const small: CreditEntitlement = { coachCreditsPerLearnerPerMonth: 3, periodKey: PERIOD };
    expect((await reserve(learner.actor.userId, learner.familyId, 2, small)).ok).toBe(true);
    const refused = await reserve(learner.actor.userId, learner.familyId, 2, small);
    expect(refused).toEqual({ ok: false, reason: "insufficient", balance: { balance: 1, monthlyAllowance: 3, periodKey: PERIOD, resetsAt: new Date("2026-12-01T00:00:00Z") } });
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 3, reserved: 2 });
    await expect(reserve(learner.actor.userId, learner.familyId, 0)).rejects.toThrow(/whole number/);
  });

  it("the least a message costs comes from credit_price, defaulting to 1", async () => {
    expect(await getTutorMessagePrice({ db })).toBe(1);
    await db.insert(creditPrice).values({ key: "tutor.message", credits: 2 });
    try {
      expect(await getTutorMessagePrice({ db })).toBe(2);
    } finally {
      await db.delete(creditPrice).where(eq(creditPrice.key, "tutor.message"));
    }
  });
});

describe("the ledger is append-only", () => {
  it("the database refuses to change or delete a ledger row", async () => {
    const learner = await createCoachLearner(world);
    await reserve(learner.actor.userId, learner.familyId, 1);
    await expect(db.update(creditLedger).set({ amount: 999 }).where(eq(creditLedger.learnerId, learner.actor.userId))).rejects.toThrow();
    await expect(db.delete(creditLedger).where(eq(creditLedger.learnerId, learner.actor.userId))).rejects.toThrow();
    expect((await ledgerFor(learner.actor.userId)).map((row) => row.amount).sort()).toEqual([1, 50]);
  });

  it("the database refuses a balance that is overspent, whatever the application does", async () => {
    const learner = await createCoachLearner(world);
    await reserve(learner.actor.userId, learner.familyId, 1);
    await expect(db.update(creditBalance).set({ spent: 51 }).where(eq(creditBalance.learnerId, learner.actor.userId))).rejects.toThrow();
    await expect(db.update(creditBalance).set({ reserved: 30, spent: 21 }).where(eq(creditBalance.learnerId, learner.actor.userId))).rejects.toThrow();
  });
});

describe("no roll-over", () => {
  it("unused credits are written off when the next period starts; the new period has the allowance and no more", async () => {
    const learner = await createCoachLearner(world);
    const id = held(await reserve(learner.actor.userId, learner.familyId, 10));
    await commitCredits(dbCtx(), { reservationId: id, amount: 10 });
    expect(await availableFor(learner.actor.userId)).toBe(40);

    const december = new Date("2026-12-02T09:00:00Z");
    const next: CreditEntitlement = { coachCreditsPerLearnerPerMonth: 50, periodKey: "2026-12" };
    // Reading the new period before using it already shows only the new allowance.
    expect((await readCreditBalance(dbCtx(december), learner.actor.userId, next)).balance).toBe(50);
    const result = await reserve(learner.actor.userId, learner.familyId, 1, next, key(), december);
    expect(result).toMatchObject({ ok: true, balance: { balance: 49, monthlyAllowance: 50, periodKey: "2026-12" } });

    expect(await balanceFor(learner.actor.userId, PERIOD)).toMatchObject({ granted: 50, spent: 10, expired: 40, reserved: 0 });
    expect(await availableFor(learner.actor.userId, PERIOD)).toBe(0);
    const expiry = (await ledgerFor(learner.actor.userId)).filter((row) => row.entryType === "expire");
    expect(expiry).toHaveLength(1);
    expect(expiry[0]).toMatchObject({ amount: 40, periodKey: PERIOD, reason: "Unused credits do not roll over" });

    // Using the new period again does not expire anything twice.
    await reserve(learner.actor.userId, learner.familyId, 1, next, key(), december);
    expect((await ledgerFor(learner.actor.userId)).filter((row) => row.entryType === "expire")).toHaveLength(1);
  });

  it("a hold still open at the month's end is not lost: when released later, those credits expire too", async () => {
    const learner = await createCoachLearner(world);
    const open = held(await reserve(learner.actor.userId, learner.familyId, 5));
    const december = new Date("2026-12-02T09:00:00Z");
    const next: CreditEntitlement = { coachCreditsPerLearnerPerMonth: 50, periodKey: "2026-12" };
    await reserve(learner.actor.userId, learner.familyId, 1, next, key(), december);
    expect(await balanceFor(learner.actor.userId, PERIOD)).toMatchObject({ reserved: 5, expired: 45 });

    await releaseCredits(dbCtx(december), { reservationId: open });
    await reserve(learner.actor.userId, learner.familyId, 1, next, key(), december);
    expect(await balanceFor(learner.actor.userId, PERIOD)).toMatchObject({ reserved: 0, expired: 50 });
    expect(await availableFor(learner.actor.userId, "2026-12")).toBe(48);
  });
});

describe("parallel requests can never overspend", () => {
  it("25 reservations at once against a balance of 6: exactly 6 succeed", async () => {
    const learner = await createCoachLearner(world);
    const small: CreditEntitlement = { coachCreditsPerLearnerPerMonth: 6, periodKey: PERIOD };
    const results = await Promise.all(Array.from({ length: 25 }, () => reserve(learner.actor.userId, learner.familyId, 1, small)));
    expect(results.filter((result) => result.ok)).toHaveLength(6);
    expect(results.filter((result) => !result.ok)).toHaveLength(19);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 6, reserved: 6, spent: 0 });
    expect((await ledgerFor(learner.actor.userId)).filter((row) => row.entryType === "reserve")).toHaveLength(6);
  });

  it("uneven amounts at once never hold more than there is", async () => {
    const learner = await createCoachLearner(world);
    const small: CreditEntitlement = { coachCreditsPerLearnerPerMonth: 10, periodKey: PERIOD };
    const amounts = [4, 3, 3, 2, 5, 1, 4, 2, 3, 1, 5, 2];
    const results = await Promise.all(amounts.map((amount) => reserve(learner.actor.userId, learner.familyId, amount, small)));
    const heldTotal = results.reduce((total, result, index) => total + (result.ok ? (amounts[index] ?? 0) : 0), 0);
    expect(heldTotal).toBeLessThanOrEqual(10);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 10, reserved: heldTotal });
  });

  it("the same key sent 10 times at once holds once", async () => {
    const learner = await createCoachLearner(world);
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(learner.actor.userId, learner.familyId, 2, FREE, "burst")));
    expect(results.filter((result) => result.ok && !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.ok && result.replayed)).toHaveLength(9);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ reserved: 2 });
  });

  it("through the whole pipeline: 12 messages at once with energy for 4 give exactly 4 answers and spend exactly 4", async () => {
    mocks.entitlement = { ...mocks.entitlement, coachCreditsPerLearnerPerMonth: 4 };
    await setCoachSetting("coach.rate_limits", { perUserPerMin: 100, perFamilyPerMin: 100, perIpPerMin: 100, globalConcurrency: 50 });
    const learner = await createCoachLearner(world);
    const h = harness();
    const results = await Promise.all(Array.from({ length: 12 }, () => h.proxy.chat(coachCtx(learner.actor), ask("the chat reply never shows up when i press send"))));

    expect(results.filter((result) => result.kind === "reply")).toHaveLength(4);
    const refused = results.filter((result) => result.kind !== "reply");
    expect(refused).toHaveLength(8);
    for (const result of refused) expect(result).toMatchObject({ kind: "denied", code: "credits_exhausted", status: 402 });
    expect(h.modelRequests).toHaveLength(4);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 4, reserved: 0, spent: 4, expired: 0 });
    const ledger = await ledgerFor(learner.actor.userId);
    expect(ledger.filter((row) => row.entryType === "commit").reduce((n, row) => n + row.amount, 0)).toBe(4);
  });
});

describe("who may see or add energy", () => {
  it("a learner sees their own, a parent their child's, and nobody else's", async () => {
    const learner = await createCoachLearner(world);
    const stranger = await createCoachLearner(world);
    expect((await getCreditBalance(coachCtx(learner.actor), learner.actor.userId)).balance).toBe(50);
    expect((await getCreditBalance(coachCtx(learner.parent), learner.actor.userId)).balance).toBe(50);
    await expect(getCreditBalance(coachCtx(stranger.actor), learner.actor.userId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getCreditBalance(coachCtx(stranger.parent), learner.actor.userId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getCreditBalance(testCtx(), learner.actor.userId)).rejects.toBeInstanceOf(AppError);
  });

  it("the energy view has whole numbers and a date, and nothing about money", async () => {
    const learner = await createCoachLearner(world);
    await reserve(learner.actor.userId, learner.familyId, 5);
    const view = toEnergyView(await getCreditBalance(coachCtx(learner.actor), learner.actor.userId));
    expect(view).toEqual({ balance: 45, monthlyAllowance: 50, percent: 90, resetsAt: "2026-12-01T00:00:00.000Z" });
    expect(JSON.stringify(view)).not.toMatch(/£|pence|price|cost/i);
  });

  it("support staff can add credits through the ledger, once per key, and it is audited", async () => {
    const learner = await createCoachLearner(world);
    const support = (await createStaff({ roles: ["support"] })).actor;
    const input = { learnerId: learner.actor.userId, amount: 20, reason: "Goodwill after an outage", idempotencyKey: "ticket-42" };
    expect((await grantCredits(coachCtx(support), input)).balance).toBe(70);
    expect((await grantCredits(coachCtx(support), input)).balance).toBe(70);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 70 });
    expect((await ledgerFor(learner.actor.userId)).filter((row) => row.entryType === "grant").map((row) => row.amount).sort()).toEqual([20, 50]);
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.action, "credits.grant"), eq(auditLog.targetId, learner.actor.userId)));
    expect(audits).toHaveLength(1);

    await expect(grantCredits(coachCtx(learner.actor), input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(grantCredits(coachCtx(learner.parent), input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(grantCredits(coachCtx(support), { ...input, amount: 0 })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("the daily spend cap", () => {
  const CAP_PENCE = 100; // £1.00 = 100,000 millipence
  const events: Array<{ kind: string; totalMillipence: number }> = [];
  const notifier: SpendNotifier = async (_ctx, event) => void events.push({ kind: event.kind, totalMillipence: event.totalMillipence });
  beforeEach(async () => {
    events.length = 0;
    await setCoachSetting("coach.daily_spend_cap_pence", CAP_PENCE);
  });

  it("counts spend per feature and in total, per UK day, rounding up", async () => {
    await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 10.2 }, notifier);
    await recordAiSpend(dbCtx(), { feature: "draft_course", costMillipence: 500 }, notifier);
    const result = await recordAiSpend(dbCtx(new Date("2026-11-16T23:59:00Z")), { feature: "tutor", costMillipence: 1 }, notifier);
    expect(result).toMatchObject({ day: "2026-11-16", totalMillipence: 512, level: "ok", alertedNow: false, trippedNow: false });
    const rows = await db.select().from(spendCounter).where(eq(spendCounter.day, "2026-11-16"));
    expect(Object.fromEntries(rows.map((row) => [row.feature, [row.costMillipence, row.requestCount]]))).toEqual({ tutor: [12, 2], draft_course: [500, 1], all: [512, 3] });
    // Just after midnight in London is a new day with a new total.
    expect((await recordAiSpend(dbCtx(new Date("2026-11-17T00:01:00Z")), { feature: "tutor", costMillipence: 7 }, notifier)).totalMillipence).toBe(7);
  });

  it("alerts admins once at 80% and leaves Coach running", async () => {
    await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 79_999 }, notifier);
    expect(events).toHaveLength(0);
    const crossing = await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 1 }, notifier);
    expect(crossing).toMatchObject({ level: "alert", alertedNow: true, trippedNow: false, totalMillipence: 80_000 });
    await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 5_000 }, notifier);
    expect(events).toEqual([{ kind: "alert", totalMillipence: 80_000 }]);
    expect(await getSetting({ db }, "coach.kill_switch")).toBe(false);
  });

  it("the real alert reaches admins through the notifications service, and shows them the figures", async () => {
    await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 85_000 });
    const notices = await db.select().from(notification).where(eq(notification.type, "coach.spend_cap_alert"));
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices.map((notice) => notice.userId)).toContain(world.owner.userId);
    expect(JSON.stringify(notices[0]?.payload)).toMatch(/£0\.85 against a cap of £1\.00/);
  });

  it("trips the kill switch at 100%: Coach answers 'AI break — back soon' and no model is called", async () => {
    const learner = await createCoachLearner(world);
    const h = harness();
    expect((await h.proxy.chat(coachCtx(learner.actor), ask("how do i start"))).kind).toBe("reply");

    await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 99_999 }, notifier);
    expect(await getSetting({ db }, "coach.kill_switch")).toBe(false);
    const tripped = await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 1 }, notifier);
    expect(tripped).toMatchObject({ level: "tripped", trippedNow: true, totalMillipence: 100_000 });
    expect(events.map((event) => event.kind)).toEqual(["alert", "tripped"]);
    expect(await getSetting({ db }, "coach.kill_switch")).toBe(true);

    const [setting] = await db.select().from(siteSetting).where(eq(siteSetting.key, "coach.kill_switch"));
    expect(setting?.updatedBy).toBeNull();
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.action, "setting.update"), eq(auditLog.targetId, "coach.kill_switch")));
    expect(audits.at(-1)).toMatchObject({ reason: "Daily AI spend cap reached" });

    const after = await h.proxy.chat(coachCtx(learner.actor), ask("how do i add the timer"));
    expect(after).toMatchObject({ kind: "denied", code: "ai_break", status: 503, message: COACH_COPY.aiBreak });
    expect(h.modelRequests).toHaveLength(1);

    // More spend the same day neither re-trips nor re-alerts.
    const again = await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 10 }, notifier);
    expect(again).toMatchObject({ level: "tripped", alertedNow: false, trippedNow: false });
    expect(events).toHaveLength(2);
  });

  it("jumping straight past 100% sends the tripped notice only", async () => {
    await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 150_000 }, notifier);
    expect(events.map((event) => event.kind)).toEqual(["tripped"]);
    expect(await getSetting({ db }, "coach.kill_switch")).toBe(true);
  });

  it("parallel calls see each other's spend: one alert, one trip, the right total", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 5_000 }, notifier)));
    expect(results.filter((result) => result.alertedNow)).toHaveLength(1);
    expect(results.filter((result) => result.trippedNow)).toHaveLength(1);
    expect(Math.max(...results.map((result) => result.totalMillipence))).toBe(100_000);
    const [all] = await db.select().from(spendCounter).where(and(eq(spendCounter.day, "2026-11-16"), eq(spendCounter.feature, "all")));
    expect(all).toMatchObject({ costMillipence: 100_000, requestCount: 20 });
    expect(await getSetting({ db }, "coach.kill_switch")).toBe(true);
  });

  it("a failed alert never fails the request that caused it", async () => {
    const broken: SpendNotifier = async () => Promise.reject(new Error("email is down"));
    await expect(recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 100_000 }, broken)).resolves.toMatchObject({ trippedNow: true });
    expect(await getSetting({ db }, "coach.kill_switch")).toBe(true);
  });

  it("the break ends the next day if the cap started it, but not if a person switched Coach off", async () => {
    await recordAiSpend(dbCtx(), { feature: "tutor", costMillipence: 100_000 }, notifier);
    const sameDay = testCtx(world.owner, { now: new Date("2026-11-16T22:00:00Z") });
    const nextDay = testCtx(world.owner, { now: new Date("2026-11-17T06:00:00Z") });
    expect(await endSpendCapBreak(sameDay)).toBe(false);
    expect(await endSpendCapBreak(nextDay)).toBe(true);
    expect(await getSetting({ db }, "coach.kill_switch")).toBe(false);
    expect(await endSpendCapBreak(nextDay)).toBe(false);

    await db.execute(sql`UPDATE site_setting SET value = 'true'::jsonb, updated_by = ${world.owner.userId} WHERE key = 'coach.kill_switch'`);
    expect(await endSpendCapBreak(nextDay)).toBe(false);
    expect(await getSetting({ db }, "coach.kill_switch")).toBe(true);
  });
});
