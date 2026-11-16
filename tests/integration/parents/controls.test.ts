import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, course, family, familyMember, notification, parentControl, user } from "@/server/db";
import { CONSENT_HOLD, saveConsents } from "@/server/services/consent";
import { NO_CONTROLS, PARENT_PAUSE_REASON, getControls, getControlsForParent, listBlockableCourses, pauseLearner, resumeLearner, updateControls } from "@/server/services/parent-controls";
import { checkLearningAllowed, recordHeartbeat } from "@/server/services/usage";
import { setSetting } from "@/server/settings";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createLearner, createParentControl, createStaff, createUsageDay } from "../../helpers/factories";
import { appError, at, giveSession, makeFamily, sessionCount, system, userRow } from "./helpers";

/** 14:00 on a Tuesday in January: UK time is UTC, and it is outside the default quiet hours. */
const AFTERNOON = new Date("2027-01-12T14:00:00Z");
const NIGHT = new Date("2027-01-12T22:30:00Z");

beforeEach(resetDb);
afterAll(closeDb);

const input = (patch: Partial<Parameters<typeof updateControls>[2]> = {}) => ({ dailyMinutesCap: 45, quietStartMin: 20 * 60, quietEndMin: 6 * 60 + 30, blockedCategories: ["games"], blockedCourseIds: [] as string[], requireApprovalForPro: true, ...patch });

async function insertCourse(patch: Partial<typeof course.$inferInsert> = {}) {
  const [row] = await db.insert(course).values({ slug: `course-${crypto.randomUUID().slice(0, 8)}`, title: "Make a Game", origin: "hand_made", status: "published", minAge: 13, category: "games", difficulty: "starter", ...patch }).returning();
  if (!row) throw new Error("no course");
  return row;
}

describe("getControls: defaults", () => {
  it("gives a learner with no saved row the site defaults: quiet hours overnight and nothing else", async () => {
    const mine = await makeFamily();
    const child = mine.children[0]!;
    const expected = { ...NO_CONTROLS, quietStartMin: 21 * 60, quietEndMin: 7 * 60 };
    expect(await getControls(child.ctx, child.id)).toEqual(expected);
    expect(await getControls(mine.parent, child.id)).toEqual(expected);
    expect(await getControls(system(), child.id)).toEqual(expected);
    // Reading never writes a row.
    expect(await db.select().from(parentControl)).toHaveLength(0);
  });

  it("follows the site setting when the owner changes the default quiet hours", async () => {
    const mine = await makeFamily();
    const owner = await createStaff({ roles: ["super_admin"] });
    await setSetting(testCtx(owner.actor), "site.default_quiet_hours", { start: "20:30", end: "06:45" }, "test");
    const controls = await getControls(mine.parent, mine.children[0]!.id);
    expect(controls.quietStartMin).toBe(20 * 60 + 30);
    expect(controls.quietEndMin).toBe(6 * 60 + 45);
  });

  it("gives an 18-year-old with no parent link no caps at all", async () => {
    // No family at all.
    const alone = await createLearner({ age: 18 });
    expect(await getControls(testCtx(alone.actor), alone.user.id)).toEqual(NO_CONTROLS);

    // A family of their own, which they own.
    const owner = await createLearner({ age: 18 });
    const [own] = await db.insert(family).values({ ownerUserId: owner.user.id, plan: "free" }).returning();
    await db.insert(familyMember).values({ familyId: own!.id, userId: owner.user.id, role: "learner" });
    expect(await getControls(testCtx({ ...owner.actor, familyId: own!.id }), owner.user.id)).toEqual(NO_CONTROLS);
  });

  it("still applies defaults and a parent's limits to an 18-year-old who is linked to a parent", async () => {
    const mine = await makeFamily([{ nickname: "Sam", age: 18 }]);
    const child = mine.children[0]!;
    expect((await getControls(child.ctx, child.id)).quietStartMin).toBe(21 * 60);
    await updateControls(mine.parent, child.id, input());
    expect((await getControls(child.ctx, child.id)).dailyMinutesCap).toBe(45);
  });

  it("applies the defaults, not 'no caps', to a 17-year-old with no family yet", async () => {
    const teen = await createLearner({ age: 17, status: "pending_parent" });
    expect((await getControls(testCtx(teen.actor), teen.user.id)).quietStartMin).toBe(21 * 60);
  });

  it("fills in the default quiet hours when a row has none, and reads equal values as 'off'", async () => {
    const mine = await makeFamily();
    const child = mine.children[0]!;
    await createParentControl({ learnerId: child.id, familyId: mine.familyId, dailyMinutesCap: 30 });
    expect(await getControls(child.ctx, child.id)).toMatchObject({ dailyMinutesCap: 30, quietStartMin: 21 * 60, quietEndMin: 7 * 60 });
    await db.update(parentControl).set({ quietStartMin: 0, quietEndMin: 0 }).where(eq(parentControl.learnerId, child.id));
    expect(await getControls(child.ctx, child.id)).toMatchObject({ quietStartMin: 0, quietEndMin: 0 });
  });

  it("ignores a row left over from a family the learner is no longer in", async () => {
    const old = await makeFamily();
    const now = await makeFamily([{ nickname: "Kit" }]);
    const child = now.children[0]!;
    await createParentControl({ learnerId: child.id, familyId: old.familyId, dailyMinutesCap: 10, paused: true });
    expect(await getControls(child.ctx, child.id)).toMatchObject({ dailyMinutesCap: null, paused: false });
  });

  it("refuses another learner, another family's parent and a signed-out visitor", async () => {
    const mine = await makeFamily();
    const theirs = await makeFamily([{ nickname: "Other" }]);
    const child = mine.children[0]!;
    expect((await appError(() => getControls(theirs.parent, child.id))).code).toBe("forbidden");
    expect((await appError(() => getControls(theirs.children[0]!.ctx, child.id))).code).toBe("forbidden");
    expect((await appError(() => getControls(testCtx(), child.id))).code).toBe("unauthenticated");
  });
});

describe("updateControls", () => {
  it("round-trips every setting, takes effect at once and is audited", async () => {
    const mine = await makeFamily();
    const child = mine.children[0]!;
    const blocked = await insertCourse();
    const saved = await updateControls(mine.parent, child.id, input({ blockedCourseIds: [blocked.id] }));
    const expected = { dailyMinutesCap: 45, quietStartMin: 1200, quietEndMin: 390, blockedCategories: ["games"], blockedCourseIds: [blocked.id], requireApprovalForPro: true, paused: false, pausedReason: null };
    expect(saved).toEqual(expected);
    // The very next read by the learner sees it: nothing is cached.
    expect(await getControls(child.ctx, child.id)).toEqual(expected);

    const view = await getControlsForParent(mine.parent, child.id);
    expect(view).toMatchObject({ customised: true, independent: false, controls: expected });

    const [row] = await db.select().from(parentControl).where(eq(parentControl.learnerId, child.id));
    expect(row).toMatchObject({ familyId: mine.familyId, updatedBy: mine.parentId });

    const entries = await db.select().from(auditLog).where(and(eq(auditLog.action, "family.controls.update"), eq(auditLog.targetId, child.id)));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorType: "parent", actorId: mine.parentId });
    expect(entries[0]?.meta).toMatchObject({ dailyMinutesCap: 45, blockedCourseCount: 1, requireApprovalForPro: true });
    expect(entries[0]?.meta.changed).toEqual(expect.arrayContaining(["dailyMinutesCap", "quietStartMin", "blockedCategories", "blockedCourseIds", "requireApprovalForPro"]));
  });

  it("saves again over the same row, and 'no limit' and 'no quiet hours' really mean none", async () => {
    const mine = await makeFamily();
    const child = mine.children[0]!;
    await updateControls(mine.parent, child.id, input());
    const cleared = await updateControls(mine.parent, child.id, input({ dailyMinutesCap: null, quietStartMin: 0, quietEndMin: 0, blockedCategories: [], requireApprovalForPro: false }));
    expect(cleared).toEqual(NO_CONTROLS);
    expect(await db.select().from(parentControl)).toHaveLength(1);
    // Quiet hours switched off stay off: the site default does not creep back in.
    expect((await checkLearningAllowed(at(child.ctx, NIGHT), child.id)).allowed).toBe(true);
  });

  it("enforces the cap and quiet hours through the real learning check", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: AFTERNOON });
    const child = mine.children[0]!;
    await updateControls(mine.parent, child.id, input({ dailyMinutesCap: 30, quietStartMin: 21 * 60, quietEndMin: 7 * 60, blockedCategories: [] }));
    expect(await checkLearningAllowed(child.ctx, child.id)).toEqual({ allowed: true, minutesLeftToday: 30 });

    await createUsageDay({ learnerId: child.id, day: "2027-01-12", seconds: 30 * 60 });
    expect(await checkLearningAllowed(child.ctx, child.id)).toMatchObject({ allowed: false, reason: "time_cap" });
    // Raising the limit applies on the next request.
    await updateControls(mine.parent, child.id, input({ dailyMinutesCap: 60, quietStartMin: 21 * 60, quietEndMin: 7 * 60, blockedCategories: [] }));
    expect(await checkLearningAllowed(child.ctx, child.id)).toEqual({ allowed: true, minutesLeftToday: 30 });
    expect(await checkLearningAllowed(at(child.ctx, NIGHT), child.id)).toMatchObject({ allowed: false, reason: "quiet_hours" });
  });

  it("refuses invalid values and unknown courses, and saves nothing", async () => {
    const mine = await makeFamily();
    const child = mine.children[0]!;
    await expect(updateControls(mine.parent, child.id, input({ dailyMinutesCap: 0 }))).rejects.toThrow();
    await expect(updateControls(mine.parent, child.id, input({ quietStartMin: 1440 }))).rejects.toThrow();
    await expect(updateControls(mine.parent, child.id, input({ blockedCategories: ["made-up"] }))).rejects.toThrow();
    const unknown = await appError(() => updateControls(mine.parent, child.id, input({ blockedCourseIds: [crypto.randomUUID()] })));
    expect(unknown.code).toBe("invalid_input");
    expect(unknown.fieldErrors?.blockedCourseIds).toBeDefined();
    expect(await db.select().from(parentControl)).toHaveLength(0);
  });

  it("is refused for another family's parent, the learner, staff without the role and visitors; nothing changes", async () => {
    const mine = await makeFamily();
    const theirs = await makeFamily([{ nickname: "Other" }]);
    const child = mine.children[0]!;
    const editor = await createStaff({ roles: ["editor"] });
    expect((await appError(() => updateControls(theirs.parent, child.id, input()))).code).toBe("not_found");
    expect((await appError(() => updateControls(child.ctx, child.id, input()))).code).toBe("forbidden");
    expect((await appError(() => updateControls(testCtx(editor.actor), child.id, input()))).code).toBe("forbidden");
    expect((await appError(() => updateControls(testCtx(), child.id, input()))).code).toBe("unauthenticated");
    expect((await appError(() => getControlsForParent(theirs.parent, child.id))).code).toBe("not_found");
    expect((await appError(() => listBlockableCourses(theirs.parent, child.id))).code).toBe("not_found");
    expect((await appError(() => getControlsForParent(mine.parent, crypto.randomUUID()))).code).toBe("not_found");
    expect(await db.select().from(parentControl)).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "family.controls.update"))).toHaveLength(0);
  });

  it("offers only live courses the child is old enough to see", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 13 }]);
    const live = await insertCourse({ title: "A live one" });
    await insertCourse({ title: "Too old", minAge: 16 });
    await insertCourse({ title: "A draft", status: "draft" });
    await insertCourse({ title: "Taken down", takenDownAt: new Date() });
    const offered = await listBlockableCourses(mine.parent, mine.children[0]!.id);
    expect(offered.map((entry) => entry.id)).toEqual([live.id]);
  });
});

describe("pause and resume", () => {
  it("pausing stops learning at once, signs the child out and shows them the reason", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: AFTERNOON });
    const child = mine.children[0]!;
    await giveSession(child.id);
    await giveSession(child.id);
    expect((await checkLearningAllowed(child.ctx, child.id)).allowed).toBe(true);

    const result = await pauseLearner(mine.parent, child.id, { reason: "  Homework first.\nBack on Friday " });
    expect(result).toMatchObject({ paused: true, status: "paused" });

    expect(await sessionCount(child.id)).toBe(0);
    expect(await userRow(child.id)).toMatchObject({ status: "paused", statusReason: PARENT_PAUSE_REASON });
    expect(await getControls(mine.parent, child.id)).toMatchObject({ paused: true, pausedReason: "Homework first. Back on Friday" });

    // The learner's own session object still says "active" until their next request; the services read the database.
    expect(await checkLearningAllowed(child.ctx, child.id)).toMatchObject({ allowed: false, reason: "paused" });
    expect(await recordHeartbeat(child.ctx, child.id, 30)).toMatchObject({ allowed: false, reason: "paused" });

    const notes = await db.select().from(notification).where(and(eq(notification.userId, child.id), eq(notification.type, "account.paused_by_parent")));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.channel).toBe("in_app");
    expect(String(notes[0]?.payload.body)).toContain("Homework first. Back on Friday");

    const audits = await db.select().from(auditLog).where(and(eq(auditLog.action, "family.child.pause"), eq(auditLog.targetId, child.id)));
    expect(audits).toHaveLength(1);
    // The reason is the parent's words to their child: it is not copied into the audit log.
    expect(JSON.stringify(audits[0]?.meta)).not.toContain("Homework");
  });

  it("resuming switches learning back on and tells the child", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: AFTERNOON });
    const child = mine.children[0]!;
    await pauseLearner(mine.parent, child.id);
    const result = await resumeLearner(mine.parent, child.id);
    expect(result).toMatchObject({ paused: false, status: "active", waitingForConsent: false });
    expect(await userRow(child.id)).toMatchObject({ status: "active", statusReason: null });
    expect(await getControls(mine.parent, child.id)).toMatchObject({ paused: false, pausedReason: null });
    expect((await checkLearningAllowed(child.ctx, child.id)).allowed).toBe(true);
    expect(await db.select().from(notification).where(and(eq(notification.userId, child.id), eq(notification.type, "account.resumed_by_parent")))).toHaveLength(1);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "family.child.resume"))).toHaveLength(1);
  });

  it("keeps the limits a parent set when pausing and resuming", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: AFTERNOON });
    const child = mine.children[0]!;
    await updateControls(mine.parent, child.id, input());
    await pauseLearner(mine.parent, child.id, { reason: "A break" });
    await resumeLearner(mine.parent, child.id);
    expect(await getControls(mine.parent, child.id)).toMatchObject({ dailyMinutesCap: 45, blockedCategories: ["games"], requireApprovalForPro: true, paused: false });
  });

  it("never switches an account on without the permissions it needs", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: AFTERNOON });
    const child = mine.children[0]!;
    // Paused by the parent, and then the parent withdraws a required consent.
    await pauseLearner(mine.parent, child.id);
    await saveConsents(mine.parent, child.id, { choices: { account_learning_data: false }, confirmPause: true });
    const resumed = await resumeLearner(mine.parent, child.id);
    expect(resumed).toMatchObject({ paused: false, status: "paused", waitingForConsent: true });
    expect(await userRow(child.id)).toMatchObject({ status: "paused", statusReason: CONSENT_HOLD.required });
    expect(await checkLearningAllowed(child.ctx, child.id)).toMatchObject({ allowed: false, reason: "consent" });

    // Giving the consent again lifts the hold, because the parent's own pause has gone.
    await saveConsents(mine.parent, child.id, { choices: { account_learning_data: true } });
    expect(await userRow(child.id)).toMatchObject({ status: "active" });
  });

  it("a pause on an account held for permissions keeps the consent hold, and applies when that is lifted", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: AFTERNOON, consent: false });
    const child = mine.children[0]!;
    await db.update(user).set({ status: "paused", statusReason: CONSENT_HOLD.required }).where(eq(user.id, child.id));
    await pauseLearner(mine.parent, child.id, { reason: "Not yet" });
    expect(await userRow(child.id)).toMatchObject({ status: "paused", statusReason: CONSENT_HOLD.required });
    await saveConsents(mine.parent, child.id, { choices: { account_learning_data: true, ai_processing: true, third_party_tools: true } });
    // Consent is complete, but the parent's pause still holds the account.
    expect((await userRow(child.id))?.status).toBe("paused");
    expect(await checkLearningAllowed(child.ctx, child.id)).toMatchObject({ allowed: false, reason: "paused" });
    expect((await resumeLearner(mine.parent, child.id)).status).toBe("active");
  });

  it("is refused across families and for a learner pausing or resuming themselves", async () => {
    const mine = await makeFamily();
    const theirs = await makeFamily([{ nickname: "Other" }]);
    const child = mine.children[0]!;
    expect((await appError(() => pauseLearner(theirs.parent, child.id, { reason: "x" }))).code).toBe("not_found");
    expect((await appError(() => pauseLearner(child.ctx, child.id))).code).toBe("forbidden");
    expect((await userRow(child.id))?.status).toBe("active");
    await pauseLearner(mine.parent, child.id);
    expect((await appError(() => resumeLearner(theirs.parent, child.id))).code).toBe("not_found");
    expect((await appError(() => resumeLearner(child.ctx, child.id))).code).toBe("forbidden");
    expect((await userRow(child.id))?.status).toBe("paused");
  });

  it("refuses a reason that is too long", async () => {
    const mine = await makeFamily();
    const error = await appError(() => pauseLearner(mine.parent, mine.children[0]!.id, { reason: "x".repeat(201) }));
    expect(error.code).toBe("invalid_input");
    expect((await userRow(mine.children[0]!.id))?.status).toBe("active");
  });

  it("leaves an 18-year-old who runs their own account alone", async () => {
    const mine = await makeFamily([{ nickname: "Sam", age: 18 }]);
    const child = mine.children[0]!;
    await db.update(user).set({ email: "sam@example.test", emailVerified: true }).where(eq(user.id, child.id));
    expect((await appError(() => pauseLearner(mine.parent, child.id))).code).toBe("forbidden");
    expect((await appError(() => updateControls(mine.parent, child.id, input()))).code).toBe("forbidden");
    expect((await getControlsForParent(mine.parent, child.id)).independent).toBe(true);
  });
});
