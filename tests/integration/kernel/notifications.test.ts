import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCKOUT_MAX_FAILURES, recordFailedSignIn, setAccountLockedHandler } from "@/server/auth/lockout";
import { notification, siteSetting, user } from "@/server/db";
import { clearSentEmails, getSentEmails, setEmailTransport, type EmailTransport } from "@/server/email";
import { runJob } from "@/server/jobs";
import { installKernelHooks } from "@/server/kernel";
import {
  handleAccountLocked,
  listNotifications,
  markRead,
  notify,
  notifyParentsOfLearner,
  notifyStaffWithRole,
  releaseDueEmails,
  unreadCount,
} from "@/server/notifications";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import {
  createFamily,
  createLearner,
  createParent,
  createParentControl,
  createStaff,
} from "../../helpers/factories";

beforeEach(async () => {
  await resetDb();
  clearSentEmails();
  setEmailTransport(undefined);
});
afterEach(() => {
  setAccountLockedHandler(undefined);
});
afterAll(async () => {
  await closeDb();
});

// Monday 16 November 2026, UK time = UTC.
const AFTERNOON = new Date("2026-11-16T15:00:00Z");
const LATE_EVENING = new Date("2026-11-16T22:30:00Z");
const NEXT_MORNING_0659 = new Date("2026-11-17T06:59:59Z");
const NEXT_MORNING_0700 = new Date("2026-11-17T07:00:00Z");

const basic = {
  type: "unlock.approved",
  title: "Unlocked",
  body: "Your parent unlocked a course.",
  href: "/home",
};
const safety = {
  type: "safety_notice.coach",
  title: "A safety notice about Maya's account",
  body: "Coach showed Maya some support information today.",
  href: "/parent/notices",
  urgent: true,
  emailTemplate: "safety_notice",
  emailData: {
    childName: "Maya",
    summary: "Coach showed Maya some support information today.",
    url: "https://app.example.test/parent/notices",
  },
};

async function familyWithLearner(age = 14, now = AFTERNOON) {
  const { family, parent, parentActor } = await createFamily({ email: "priya@example.test" });
  const learner = await createLearner({ age, familyId: family.id, now });
  return { family, parent, parentActor, learner };
}

describe("notify: learners", () => {
  it("stores an in-app notification that is visible at once outside quiet hours", async () => {
    const { learner } = await familyWithLearner();
    const ctx = testCtx(learner.actor, { now: AFTERNOON });
    const result = await notify(ctx, { userId: learner.user.id, ...basic });
    expect(result).toMatchObject({ deliverAfter: null, email: "not_requested", duplicate: false });
    expect(await unreadCount(ctx, learner.user.id)).toBe(1);
    expect(await listNotifications(ctx, learner.user.id)).toEqual([
      {
        id: result.notificationId,
        type: "unlock.approved",
        title: "Unlocked",
        body: "Your parent unlocked a course.",
        href: "/home",
        urgent: false,
        read: false,
        at: AFTERNOON,
      },
    ]);
  });

  it("holds a notification raised in the site's default quiet hours until they end", async () => {
    const { learner } = await familyWithLearner();
    const result = await notify(testCtx(undefined, { now: LATE_EVENING }), {
      userId: learner.user.id,
      ...basic,
    });
    expect(result.deliverAfter?.toISOString()).toBe("2026-11-17T07:00:00.000Z");
    const [row] = await db.select().from(notification);
    expect(row?.deliverAfter?.toISOString()).toBe("2026-11-17T07:00:00.000Z");

    // Not shown and not counted while it waits…
    for (const now of [LATE_EVENING, NEXT_MORNING_0659]) {
      const ctx = testCtx(learner.actor, { now });
      expect(await listNotifications(ctx, learner.user.id)).toEqual([]);
      expect(await unreadCount(ctx, learner.user.id)).toBe(0);
      expect(await markRead(ctx, learner.user.id, "all")).toBe(0);
    }
    // …and there from 07:00, dated when it appeared rather than when it was raised.
    const morning = testCtx(learner.actor, { now: NEXT_MORNING_0700 });
    expect(await unreadCount(morning, learner.user.id)).toBe(1);
    expect((await listNotifications(morning, learner.user.id))[0]).toMatchObject({
      title: "Unlocked",
      at: NEXT_MORNING_0700,
    });
  });

  it("uses the quiet hours a parent has set, not the site default", async () => {
    const { family, learner } = await familyWithLearner();
    // 19:00–06:30
    await createParentControl({
      learnerId: learner.user.id,
      familyId: family.id,
      quietStartMin: 19 * 60,
      quietEndMin: 6 * 60 + 30,
    });
    const evening = await notify(testCtx(undefined, { now: new Date("2026-11-16T19:30:00Z") }), {
      userId: learner.user.id,
      ...basic,
    });
    expect(evening.deliverAfter?.toISOString()).toBe("2026-11-17T06:30:00.000Z");
    // 06:45 is inside the site default (until 07:00) but outside the parent's window: immediate.
    const early = await notify(testCtx(undefined, { now: new Date("2026-11-17T06:45:00Z") }), {
      userId: learner.user.id,
      ...basic,
    });
    expect(early.deliverAfter).toBeNull();
  });

  it("falls back to the site default when the parent has set no window, and follows a changed default", async () => {
    const { family, learner } = await familyWithLearner();
    await createParentControl({ learnerId: learner.user.id, familyId: family.id });
    expect(
      (await notify(testCtx(undefined, { now: LATE_EVENING }), { userId: learner.user.id, ...basic }))
        .deliverAfter,
    ).not.toBeNull();
    await db
      .insert(siteSetting)
      .values({ key: "site.default_quiet_hours", value: { start: "23:00", end: "06:00" } });
    expect(
      (await notify(testCtx(undefined, { now: LATE_EVENING }), { userId: learner.user.id, ...basic }))
        .deliverAfter,
    ).toBeNull();
    const late = await notify(testCtx(undefined, { now: new Date("2026-11-16T23:10:00Z") }), {
      userId: learner.user.id,
      ...basic,
    });
    expect(late.deliverAfter?.toISOString()).toBe("2026-11-17T06:00:00.000Z");
  });

  it("urgent does not break a learner's quiet hours", async () => {
    const { learner } = await familyWithLearner();
    const result = await notify(testCtx(undefined, { now: LATE_EVENING }), {
      userId: learner.user.id,
      ...basic,
      urgent: true,
    });
    expect(result.deliverAfter).not.toBeNull();
    expect(
      (await listNotifications(testCtx(learner.actor, { now: NEXT_MORNING_0700 }), learner.user.id))[0]
        ?.urgent,
    ).toBe(true);
  });

  it("never emails a learner under 18, even when asked to", async () => {
    const { family } = await createFamily();
    for (const age of [13, 15, 17]) {
      const learner = await createLearner({ age, familyId: family.id, now: AFTERNOON });
      const result = await notify(testCtx(undefined, { now: AFTERNOON }), {
        userId: learner.user.id,
        ...safety,
        channels: ["in_app", "email"],
      });
      expect(result.email).toBe("not_eligible");
      expect(result.notificationId).not.toBeNull();
    }
    expect(getSentEmails()).toHaveLength(0);
    expect(await db.select().from(notification).where(eq(notification.channel, "email"))).toHaveLength(0);
  });

  it("does not email an under-18 even if their account somehow holds a real address", async () => {
    const { learner } = await familyWithLearner(15);
    await db.update(user).set({ email: "teen@example.test" }).where(eq(user.id, learner.user.id));
    const result = await notify(testCtx(undefined, { now: AFTERNOON }), {
      userId: learner.user.id,
      ...safety,
    });
    expect(result.email).toBe("not_eligible");
    expect(getSentEmails()).toHaveLength(0);
  });

  it("emails an 18-year-old learner who has given an address, but not during quiet hours", async () => {
    const adult = await createLearner({ age: 18, now: AFTERNOON });
    // No address yet: in-app only.
    expect(
      (await notify(testCtx(undefined, { now: AFTERNOON }), { userId: adult.user.id, ...safety })).email,
    ).toBe("not_eligible");

    await db.update(user).set({ email: "adult@example.test" }).where(eq(user.id, adult.user.id));
    const day = await notify(testCtx(undefined, { now: AFTERNOON }), { userId: adult.user.id, ...safety });
    expect(day.email).toBe("sent");
    expect(getSentEmails().map((e) => e.to)).toEqual(["adult@example.test"]);

    const night = await notify(testCtx(undefined, { now: LATE_EVENING }), {
      userId: adult.user.id,
      ...safety,
    });
    expect(night.email).toBe("deferred");
    expect(getSentEmails()).toHaveLength(1);

    // The release job leaves it alone until the window ends, then sends it once.
    expect(await releaseDueEmails({ db, now: NEXT_MORNING_0659 })).toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    const run = await runJob("notifications.release", undefined, { now: NEXT_MORNING_0700 });
    expect(run).toMatchObject({ status: "succeeded", summary: { sent: 1, failed: 0, skipped: 0 } });
    expect(getSentEmails()).toHaveLength(2);
    expect(await releaseDueEmails({ db, now: new Date("2026-11-17T07:10:00Z") })).toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    expect(getSentEmails()).toHaveLength(2);
  });
});

describe("notify: parents and staff", () => {
  it("a safety notice to a parent is immediate even in the child's quiet hours, in the app and by email", async () => {
    const { parent, parentActor, learner } = await familyWithLearner();
    const night = testCtx(undefined, { now: LATE_EVENING });

    // The same moment: the child's own notification waits…
    expect((await notify(night, { userId: learner.user.id, ...basic })).deliverAfter).not.toBeNull();
    // …the parents' safety notice does not.
    const results = await notifyParentsOfLearner(night, learner.user.id, safety);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ userId: parent.id, deliverAfter: null, email: "sent" });

    const parentCtx = testCtx(parentActor, { now: LATE_EVENING });
    expect(await unreadCount(parentCtx, parent.id)).toBe(1);
    expect((await listNotifications(parentCtx, parent.id))[0]).toMatchObject({
      type: "safety_notice.coach",
      urgent: true,
      href: "/parent/notices",
      at: LATE_EVENING,
    });
    const [email] = getSentEmails();
    expect(email).toMatchObject({
      to: "priya@example.test",
      template: "safety_notice",
      subject: "A safety notice about Maya's account",
    });

    const rows = await db.select().from(notification).where(eq(notification.userId, parent.id));
    expect(rows.find((r) => r.channel === "email")).toMatchObject({ deliverAfter: null, failedAt: null });
    expect(rows.find((r) => r.channel === "email")?.sentAt).toEqual(LATE_EVENING);
  });

  it("tells every parent in the family, and nobody outside it", async () => {
    const { family, learner } = await familyWithLearner();
    await createParent({ familyId: family.id, email: "second@example.test" });
    await createParent({ email: "stranger@example.test" });
    const results = await notifyParentsOfLearner(
      testCtx(undefined, { now: AFTERNOON }),
      learner.user.id,
      safety,
    );
    expect(results).toHaveLength(2);
    expect(
      getSentEmails()
        .map((e) => e.to)
        .sort(),
    ).toEqual(["priya@example.test", "second@example.test"]);
  });

  it("a learner with no family yet has no parents to tell", async () => {
    const teenFirst = await createLearner({ age: 14, status: "pending_parent" });
    expect(await notifyParentsOfLearner(testCtx(), teenFirst.user.id, safety)).toEqual([]);
  });

  it("an email failure is recorded and does not lose the in-app notice or throw", async () => {
    const { parent, parentActor, learner } = await familyWithLearner();
    const broken: EmailTransport = {
      name: "resend",
      send: async () => Promise.reject(new Error("Resend refused the email (HTTP 500)")),
    };
    setEmailTransport(broken);
    const [result] = await notifyParentsOfLearner(
      testCtx(undefined, { now: AFTERNOON }),
      learner.user.id,
      safety,
    );
    expect(result).toMatchObject({ email: "failed" });
    expect(await unreadCount(testCtx(parentActor, { now: AFTERNOON }), parent.id)).toBe(1);
    const rows = await db.select().from(notification).where(eq(notification.channel, "email"));
    expect(rows[0]).toMatchObject({ sentAt: null, error: "Resend refused the email (HTTP 500)" });
    expect(rows[0]?.failedAt).toEqual(AFTERNOON);
  });

  it("notifies staff by role: active holders only, once each", async () => {
    const dsl = await createStaff({ roles: ["dsl", "admin"], email: "dsl@example.test" });
    await createStaff({ roles: ["editor"], email: "editor@example.test" });
    await createStaff({ roles: ["dsl"], email: "gone@example.test", status: "locked" });
    const alert = {
      type: "safeguarding.case_opened",
      title: "Safeguarding case needs you",
      body: "A critical case has been opened.",
      href: "/studio/safeguarding",
      urgent: true,
      emailTemplate: "safeguarding_alert",
      emailData: {
        severity: "critical",
        caseRef: "SC-1",
        dueBy: "19:00",
        url: "https://app.example.test/studio/safeguarding",
      },
    };
    const results = await notifyStaffWithRole(
      testCtx(undefined, { now: LATE_EVENING }),
      ["dsl", "admin"],
      alert,
    );
    expect(results.map((r) => r.userId)).toEqual([dsl.user.id]);
    expect(results[0]).toMatchObject({ deliverAfter: null, email: "sent" });
    expect(getSentEmails().map((e) => e.to)).toEqual(["dsl@example.test"]);
    expect(await notifyStaffWithRole(testCtx(), "moderator", alert)).toEqual([]);
  });
});

describe("notify: safeguards", () => {
  it("the same dedupe key notifies once", async () => {
    const { parent, learner } = await familyWithLearner();
    const ctx = testCtx(undefined, { now: AFTERNOON });
    const first = await notifyParentsOfLearner(ctx, learner.user.id, { ...safety, dedupeKey: "case:1" });
    const second = await notifyParentsOfLearner(ctx, learner.user.id, { ...safety, dedupeKey: "case:1" });
    expect(first[0]?.duplicate).toBe(false);
    expect(second[0]).toMatchObject({ duplicate: true, notificationId: null });
    expect(await db.select().from(notification).where(eq(notification.userId, parent.id))).toHaveLength(2); // one in-app, one email
    expect(getSentEmails()).toHaveLength(1);
  });

  it("only links to pages on this site", async () => {
    const { learner } = await familyWithLearner();
    for (const href of ["https://evil.example", "//evil.example", "javascript:alert(1)", "home"]) {
      await expect(notify(testCtx(), { userId: learner.user.id, ...basic, href })).rejects.toThrow(
        /path on this site/,
      );
    }
    expect(await db.select().from(notification)).toHaveLength(0);
  });

  it("an unknown or deleted user is skipped quietly", async () => {
    expect(
      await notify(testCtx(), { userId: "00000000-0000-4000-8000-000000000000", ...basic }),
    ).toMatchObject({ notificationId: null });
    const { user: gone } = await createParent({ status: "deleted" });
    expect(await notify(testCtx(), { userId: gone.id, ...basic })).toMatchObject({ notificationId: null });
    expect(await db.select().from(notification)).toHaveLength(0);
  });
});

describe("reading notifications", () => {
  it("people see only their own; a sibling, another parent and the public are refused", async () => {
    const { family, parentActor, learner } = await familyWithLearner();
    const sibling = await createLearner({ age: 16, familyId: family.id });
    const other = await createParent();
    await notify(testCtx(undefined, { now: AFTERNOON }), { userId: learner.user.id, ...basic });

    const now = AFTERNOON;
    await expect(listNotifications(testCtx(sibling.actor, { now }), learner.user.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(listNotifications(testCtx(other.actor, { now }), learner.user.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(listNotifications(testCtx(parentActor, { now }), learner.user.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(unreadCount(testCtx(undefined, { now }), learner.user.id)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(markRead(testCtx(sibling.actor, { now }), learner.user.id, "all")).rejects.toMatchObject({
      code: "forbidden",
    });

    // Support staff may look, but cannot mark someone else's as read.
    const support = testCtx((await createStaff({ roles: ["support"] })).actor, { now });
    expect(await listNotifications(support, learner.user.id)).toHaveLength(1);
    await expect(markRead(support, learner.user.id, "all")).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      listNotifications(testCtx((await createStaff({ roles: ["editor"] })).actor, { now }), learner.user.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("marks one or all as read, and unreadOnly filters", async () => {
    const { learner } = await familyWithLearner();
    const raise = testCtx(undefined, { now: AFTERNOON });
    const a = await notify(raise, { userId: learner.user.id, ...basic, title: "A" });
    await notify(testCtx(undefined, { now: new Date(AFTERNOON.getTime() + 1000) }), {
      userId: learner.user.id,
      ...basic,
      title: "B",
    });
    await notify(testCtx(undefined, { now: new Date(AFTERNOON.getTime() + 2000) }), {
      userId: learner.user.id,
      ...basic,
      title: "C",
    });

    const ctx = testCtx(learner.actor, { now: new Date(AFTERNOON.getTime() + 60_000) });
    expect((await listNotifications(ctx, learner.user.id)).map((n) => n.title)).toEqual(["C", "B", "A"]);
    expect(await markRead(ctx, learner.user.id, [a.notificationId ?? ""])).toBe(1);
    expect(await markRead(ctx, learner.user.id, [a.notificationId ?? ""])).toBe(0);
    expect(await unreadCount(ctx, learner.user.id)).toBe(2);
    expect((await listNotifications(ctx, learner.user.id, { unreadOnly: true })).map((n) => n.title)).toEqual(
      ["C", "B"],
    );
    expect((await listNotifications(ctx, learner.user.id)).find((n) => n.title === "A")?.read).toBe(true);
    expect(await markRead(ctx, learner.user.id, "all")).toBe(2);
    expect(await unreadCount(ctx, learner.user.id)).toBe(0);
    expect(await markRead(ctx, learner.user.id, [])).toBe(0);
  });

  it("a paused learner can still read their notifications", async () => {
    const paused = await createLearner({ age: 14, status: "paused" });
    await notify(testCtx(undefined, { now: AFTERNOON }), { userId: paused.user.id, ...basic });
    expect(await unreadCount(testCtx(paused.actor, { now: AFTERNOON }), paused.user.id)).toBe(1);
  });
});

describe("account lockout", () => {
  it("notifies the learner's parents at once when repeated wrong passwords lock the account", async () => {
    const { parent, parentActor, learner } = await familyWithLearner();
    installKernelHooks();
    const now = new Date();
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) await recordFailedSignIn(db, learner.user.id, now);

    const notices = await listNotifications(testCtx(parentActor), parent.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      type: "safety_notice.account_locked",
      title: "Sign-in is paused on Maya's account",
      urgent: true,
      href: "/parent",
    });
    const emails = getSentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      to: "priya@example.test",
      template: "account_locked",
      subject: "Sign-in has been paused for a short time",
    });
    expect(emails[0]?.text).toContain("Maya's account");
    // The learner is told nothing by email and gets no notice about it.
    expect(await db.select().from(notification).where(eq(notification.userId, learner.user.id))).toHaveLength(
      0,
    );

    // A further wrong password while locked does not notify again.
    await recordFailedSignIn(db, learner.user.id, now);
    expect(getSentEmails()).toHaveLength(1);
  });

  it("tells a parent or staff member about a lock on their own account", async () => {
    const parent = await createParent({ email: "priya@example.test" });
    const lockedUntil = new Date("2026-11-16T15:15:00Z");
    const [result] = await handleAccountLocked(
      { userId: parent.user.id, kind: "parent", lockedUntil },
      testCtx(undefined, { now: AFTERNOON }),
    );
    expect(result).toMatchObject({ email: "sent", deliverAfter: null });
    expect(getSentEmails()[0]?.text).toContain("15:15 on 16 November 2026");
    const staff = await createStaff({ email: "sam@example.test" });
    await handleAccountLocked(
      { userId: staff.user.id, kind: "staff", lockedUntil },
      testCtx(undefined, { now: AFTERNOON }),
    );
    expect((await listNotifications(testCtx(staff.actor, { now: AFTERNOON }), staff.user.id))[0]?.href).toBe(
      "/studio",
    );
  });
});
