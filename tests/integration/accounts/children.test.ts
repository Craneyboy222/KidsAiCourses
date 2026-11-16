import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { account, auditLog, dataRequest, familyMember, inviteCode, learnerProfile, user } from "@/server/db/schema";
import { getSentEmails } from "@/server/email";
import { addChild, issueChildInvite, removeChild, resetChildPassword } from "@/server/services/children";
import { CONSENT_HOLD } from "@/server/services/consent";
import { countSeatsUsed, getFamily, getLearnerSummary, listChildren, listParentUserIds } from "@/server/services/family";
import { redeemInviteCode } from "@/server/services/invite";
import { closeDb, db, testCtx } from "../../helpers/db";
import { TEST_PASSWORD, createLearner, createParent } from "../../helpers/factories";
import { NOW, addSession, birthFor, expectNoPlaceholderEmail, freshAccountsDb, mockedEntitlement, plan, sessionCount, userRow } from "./helpers";

vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));

beforeEach(async () => {
  await freshAccountsDb();
});
afterAll(async () => {
  await closeDb();
});

const child = (over: Record<string, unknown> = {}) => ({ ...birthFor(14), nickname: "Maya", username: "pixel_wren_77", password: TEST_PASSWORD, ...over });

describe("adding a child", () => {
  it("creates a learner with a nickname, birth month and year and username, and no email of their own", async () => {
    const { actor, family } = await createParent();
    const result = await addChild(testCtx(actor, { now: NOW }), child());
    expect(result).toMatchObject({ nickname: "Maya", username: "pixel_wren_77", invite: null });
    expectNoPlaceholderEmail(result);

    const row = await userRow(result.learnerId);
    expect(row).toMatchObject({ kind: "learner", username: "pixel_wren_77", name: "Maya" });
    expect(row?.email).toMatch(/@learner\.invalid$/); // the hidden placeholder, never a real address
    const profile = (await db.select().from(learnerProfile).where(eq(learnerProfile.userId, result.learnerId)))[0];
    expect(profile).toMatchObject({ nickname: "Maya", birthMonth: 5, birthYear: 2012, safetyBand: "teen_13_15", pathway: "ks3", firstName: null });
    expect(profile?.avatarSeed).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await db.select().from(familyMember).where(eq(familyMember.userId, result.learnerId))).toMatchObject([{ familyId: family.id, role: "learner", addedBy: actor.userId }]);
  });

  it("holds the new account until the parent has completed the consent centre", async () => {
    const { actor } = await createParent();
    const { learnerId } = await addChild(testCtx(actor, { now: NOW }), child());
    expect(await userRow(learnerId)).toMatchObject({ status: "paused", statusReason: CONSENT_HOLD.required });
  });

  it("lets the child sign in with the password the parent set", async () => {
    const { actor } = await createParent();
    await addChild(testCtx(actor, { now: NOW }), child());
    const signedIn = await getAuth().api.signInUsername({ body: { username: "Pixel_Wren_77", password: TEST_PASSWORD } });
    expect(signedIn?.token).toBeTruthy();
    expectNoPlaceholderEmail(signedIn);
  });

  it("with no password, issues a one-time invite code, shows it once and emails it to the parent", async () => {
    const { actor, user: parent } = await createParent({ email: "priya@example.test" });
    const result = await addChild(testCtx(actor, { now: NOW }), child({ password: null }));
    expect(result.invite?.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(result.invite?.formatted).toBe(`${result.invite?.code.slice(0, 4)}-${result.invite?.code.slice(4)}`);
    expect(result.invite?.expiresAt.getTime()).toBe(NOW.getTime() + 72 * 60 * 60 * 1000);

    // Stored only as a hash.
    const stored = await db.select().from(inviteCode);
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(result.invite?.code);
    expect(await db.select().from(account).where(eq(account.userId, result.learnerId))).toHaveLength(0);

    const emails = getSentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: parent.email, template: "invite_code" });
    expect(emails[0]?.text).toContain(result.invite?.formatted);
  });

  it("allows children up to the plan's seats and refuses one more", async () => {
    plan.seats = 2;
    const { actor, family } = await createParent();
    const ctx = testCtx(actor, { now: NOW });
    await addChild(ctx, child({ username: "pixel_wren_77" }));
    await addChild(ctx, child({ nickname: "Josh", username: "calm_falcon_30", ...birthFor(17) }));
    expect(await countSeatsUsed(ctx, family.id)).toBe(2);

    const third = addChild(ctx, child({ nickname: "Sam", username: "sunny_heron_41" }));
    await expect(third).rejects.toMatchObject({ code: "entitlement_required", status: 409 });
    await expect(third).rejects.toThrow(/room for 2 learners/);
    expect(await countSeatsUsed(ctx, family.id)).toBe(2);
    expect(await db.select().from(user).where(eq(user.username, "sunny_heron_41"))).toHaveLength(0);

    // More seats on the plan (the payments slice decides): now there is room.
    plan.seats = 4;
    await expect(addChild(ctx, child({ nickname: "Sam", username: "sunny_heron_41" }))).resolves.toMatchObject({ username: "sunny_heron_41" });
  });

  it("never lets two requests at the same moment both take the last seat", async () => {
    plan.seats = 1;
    const { actor, family } = await createParent();
    const ctx = testCtx(actor, { now: NOW });
    const results = await Promise.allSettled([
      addChild(ctx, child({ username: "pixel_wren_77" })),
      addChild(ctx, child({ nickname: "Josh", username: "calm_falcon_30" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await countSeatsUsed(ctx, family.id)).toBe(1);
  });

  it("frees the seat only once a removed child is actually deleted", async () => {
    plan.seats = 1;
    const { actor, family } = await createParent();
    const ctx = testCtx(actor, { now: NOW });
    const first = await addChild(ctx, child());
    await removeChild(ctx, first.learnerId);
    // Inside the 14-day undo window the place is still theirs.
    expect(await countSeatsUsed(ctx, family.id)).toBe(1);
    await db.update(user).set({ status: "deleted" }).where(eq(user.id, first.learnerId));
    expect(await countSeatsUsed(ctx, family.id)).toBe(0);
  });

  it("refuses a username with the nickname, a year or a place in it, and offers alternatives", async () => {
    const { actor } = await createParent();
    const ctx = testCtx(actor, { now: NOW });
    for (const username of ["maya_makes", "wren_2012", "wren_12", "leeds_wren", "wren_year9"]) {
      const error = (await addChild(ctx, child({ username })).catch((e: unknown) => e)) as { code: string; fieldErrors?: Record<string, string[]>; detail?: { suggestions?: string[] } };
      expect(error.code, username).toBe("invalid_input");
      expect(error.fieldErrors?.username?.[0], username).toBeTruthy();
      expect(error.detail?.suggestions, username).toHaveLength(3);
    }
    expect(await db.select().from(learnerProfile)).toHaveLength(0);
  });

  it("refuses a nickname that is a contact detail or a full name", async () => {
    const { actor } = await createParent();
    await expect(addChild(testCtx(actor, { now: NOW }), child({ nickname: "maya@example.com" }))).rejects.toMatchObject({ code: "invalid_input", fieldErrors: { nickname: expect.any(Array) } });
    await expect(addChild(testCtx(actor, { now: NOW }), child({ nickname: "Maya Jane Smith" }))).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("is for parents only, and only in their own family", async () => {
    const { actor: learner } = await createLearner({ age: 17 });
    await expect(addChild(testCtx(learner, { now: NOW }), child())).rejects.toMatchObject({ code: "forbidden" });
    await expect(addChild(testCtx(undefined, { now: NOW }), child())).rejects.toMatchObject({ code: "forbidden" });
  });

  it("records an audit entry without the child's details", async () => {
    const { actor } = await createParent();
    const { learnerId } = await addChild(testCtx(actor, { now: NOW }), child());
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "family.child.add"));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ targetId: learnerId, actorId: actor.userId });
    expect(JSON.stringify(logs[0]?.meta)).not.toMatch(/Maya|pixel_wren|learner\.invalid/);
  });
});

describe("family reads", () => {
  it("never return an email address, real or placeholder", async () => {
    const { actor, family } = await createParent({ email: "priya@example.test" });
    const ctx = testCtx(actor, { now: NOW });
    const { learnerId } = await addChild(ctx, child());

    const everything = {
      summary: await getLearnerSummary(ctx, learnerId),
      children: await listChildren(ctx, family.id),
      parents: await listParentUserIds(ctx, family.id),
      family: await getFamily(ctx, family.id),
    };
    expectNoPlaceholderEmail(everything);
    expect(JSON.stringify(everything)).not.toContain("priya@example.test");
    expect(everything.summary).toMatchObject({ learnerId, familyId: family.id, nickname: "Maya", username: "pixel_wren_77", age: 14, safetyBand: "teen_13_15", pathway: "ks3", status: "paused", onboardingCompleted: false });
    expect(everything.family).toMatchObject({ ownerUserId: actor.userId, ownerEmailVerified: true, ownerKind: "parent", plan: "free" });
    expect(everything.parents).toEqual([actor.userId]);
  });

  it("uses the stricter band until the daily job catches up with a birthday", async () => {
    const { family } = await createParent();
    // Stored as 13–15 at sign-up; a year later the live calculation says 16–17 but the stored band has not moved.
    const { user: learner } = await createLearner({ age: 15, familyId: family.id, now: NOW });
    const later = new Date("2027-11-16T10:00:00Z");
    expect(await getLearnerSummary({ db, now: later }, learner.id)).toMatchObject({ age: 16, safetyBand: "teen_13_15" });
  });
});

describe("resetChildPassword", () => {
  it("sets a new password, signs the child out everywhere and stops the old password working", async () => {
    const { actor, family } = await createParent();
    const { user: learner } = await createLearner({ familyId: family.id, username: "pixel_wren_77", password: TEST_PASSWORD });
    await addSession(learner.id);
    await addSession(learner.id);

    const result = await resetChildPassword(testCtx(actor, { now: NOW }), learner.id, { password: "meadow-kettle-comet-77" });
    expect(result).toEqual({ learnerId: learner.id, invite: null });
    expect(await sessionCount(learner.id)).toBe(0);
    await expect(getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: TEST_PASSWORD } })).rejects.toBeDefined();
    const signedIn = await getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: "meadow-kettle-comet-77" } });
    expect(signedIn?.token).toBeTruthy();
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "family.child.reset_password"))).toHaveLength(1);
  });

  it("with no new password, removes the old one, signs the child out and issues a one-time code", async () => {
    const { actor, family } = await createParent();
    const { user: learner } = await createLearner({ familyId: family.id, username: "pixel_wren_77", password: TEST_PASSWORD });
    await addSession(learner.id);

    const ctx = testCtx(actor, { now: NOW });
    const result = await resetChildPassword(ctx, learner.id);
    expect(result.invite?.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(await sessionCount(learner.id)).toBe(0);
    await expect(getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: TEST_PASSWORD } })).rejects.toBeDefined();

    await redeemInviteCode(testCtx(undefined, { now: NOW }), { username: "pixel_wren_77", code: result.invite?.code ?? "", password: "meadow-kettle-comet-77" });
    expect((await getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: "meadow-kettle-comet-77" } }))?.token).toBeTruthy();
  });

  it("applies the password policy and changes nothing when the new password is refused", async () => {
    const { actor, family } = await createParent();
    const { user: learner } = await createLearner({ familyId: family.id, username: "pixel_wren_77", password: TEST_PASSWORD });
    await addSession(learner.id);
    await expect(resetChildPassword(testCtx(actor, { now: NOW }), learner.id, { password: "pixel_wren_77" })).rejects.toMatchObject({ code: "invalid_input", fieldErrors: { password: expect.any(Array) } });
    expect(await sessionCount(learner.id)).toBe(1);
    expect((await getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: TEST_PASSWORD } }))?.token).toBeTruthy();
  });

  it("cannot be used on a child in another family, or by the child", async () => {
    const mine = await createParent();
    const theirs = await createParent();
    const { user: other, actor: otherActor } = await createLearner({ familyId: theirs.family.id });
    await expect(resetChildPassword(testCtx(mine.actor, { now: NOW }), other.id, { password: "meadow-kettle-comet-77" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(resetChildPassword(testCtx(otherActor, { now: NOW }), other.id, { password: "meadow-kettle-comet-77" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("is no longer the parent's to do once an 18-year-old runs their own account", async () => {
    const { actor, family } = await createParent();
    const { user: adult } = await createLearner({ age: 18, familyId: family.id, now: NOW });
    await db.update(user).set({ email: "josh@example.test", emailVerified: true }).where(eq(user.id, adult.id));
    await expect(resetChildPassword(testCtx(actor, { now: NOW }), adult.id, { password: "meadow-kettle-comet-77" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("a fresh invite and removing a child", () => {
  it("a new invite replaces the old one without touching a password that already works", async () => {
    const { actor, family } = await createParent();
    const { user: learner } = await createLearner({ familyId: family.id, username: "pixel_wren_77", password: TEST_PASSWORD });
    const ctx = testCtx(actor, { now: NOW });
    const first = await issueChildInvite(ctx, learner.id);
    const second = await issueChildInvite(ctx, learner.id);
    expect(second.code).not.toBe(first.code);
    const live = await db.select().from(inviteCode).where(and(eq(inviteCode.learnerId, learner.id)));
    expect(live.filter((row) => row.revokedAt === null)).toHaveLength(1);
    expect((await getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: TEST_PASSWORD } }))?.token).toBeTruthy();
  });

  it("removing a child starts a deletion with a 14-day undo, signs them out and deletes nothing yet", async () => {
    const { actor, family } = await createParent();
    const { user: learner } = await createLearner({ familyId: family.id });
    await addSession(learner.id);
    const ctx = testCtx(actor, { now: NOW });

    const result = await removeChild(ctx, learner.id);
    expect(result.undoUntil.getTime()).toBe(NOW.getTime() + 14 * 24 * 60 * 60 * 1000);
    expect(await userRow(learner.id)).toMatchObject({ status: "pending_deletion" });
    expect(await sessionCount(learner.id)).toBe(0);
    expect(await db.select().from(dataRequest)).toMatchObject([{ kind: "delete", status: "requested", learnerId: learner.id, familyId: family.id, requestedBy: actor.userId }]);
    expect(await db.select().from(learnerProfile)).toHaveLength(1);

    // Asking twice does not create a second request.
    await expect(removeChild(ctx, learner.id)).rejects.toMatchObject({ code: "conflict" });
    expect(await db.select().from(dataRequest)).toHaveLength(1);
  });
});
