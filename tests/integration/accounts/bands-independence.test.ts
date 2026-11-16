import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/server/auth/auth";
import type { LearnerActor } from "@/server/authz/actor";
import { loadActor, systemCtx } from "@/server/context";
import { auditLog, consentRecord, family as familyTable, familyMember, inviteCode, learnerProfile, notification, parentControl, user, verification } from "@/server/db/schema";
import { clearSentEmails, getSentEmails } from "@/server/email";
import { accountsRecalculateBands } from "@/server/jobs/accounts";
import { resetChildPassword } from "@/server/services/children";
import { CONSENT_HOLD, saveConsents } from "@/server/services/consent";
import { getFamily, isIndependentLearner, listChildren } from "@/server/services/family";
import { confirmIndependence, getIndependenceState, removeParentLink, requestIndependence } from "@/server/services/independence";
import { recalculateBands } from "@/server/services/safety-band";
import { closeDb, db, testCtx } from "../../helpers/db";
import { TEST_PASSWORD, createInviteCode, createLearner, createParent, createParentControl } from "../../helpers/factories";
import { NOW, REQUIRED_TICKED, expectNoPlaceholderEmail, freshAccountsDb, mockedEntitlement, userRow } from "./helpers";

vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));

beforeEach(async () => {
  await freshAccountsDb();
});
afterAll(async () => {
  await closeDb();
});

const profileOf = async (userId: string) => (await db.select().from(learnerProfile).where(eq(learnerProfile.userId, userId)))[0];
const noticesFor = async (userId: string) => db.select().from(notification).where(eq(notification.userId, userId));
const actorFor = async (userId: string, now: Date) => (await loadActor(db, { userId, createdAt: now, twoFactorVerified: false }, now)) as LearnerActor;

describe("the daily band recalculation", () => {
  it("moves a learner from 13–15 to 16–17 on the first day after their birth month, and tells them and their parents", async () => {
    const { family, user: parent } = await createParent({ email: "priya@example.test" });
    // Born November 2010: 15 until the end of November 2026.
    const { user: learner } = await createLearner({ birthYear: 2010, birthMonth: 11, familyId: family.id, nickname: "Maya", now: NOW });
    expect(await profileOf(learner.id)).toMatchObject({ safetyBand: "teen_13_15", pathway: "ks4" });

    const lastDay = await recalculateBands({ db, now: new Date("2026-11-30T23:30:00Z") });
    expect(lastDay).toMatchObject({ checked: 1, bandChanged: 0, independenceOffered: 0 });
    expect(await profileOf(learner.id)).toMatchObject({ safetyBand: "teen_13_15" });
    expect(await noticesFor(learner.id)).toHaveLength(0);

    const firstOfDecember = new Date("2026-12-01T00:10:00Z");
    const result = await accountsRecalculateBands.run(systemCtx("accounts.recalculate_bands", { now: firstOfDecember }), undefined as never);
    expect(result).toEqual({ checked: 1, bandChanged: 1, pathwayChanged: 0, independenceOffered: 0, under13: 0 });
    expect(await profileOf(learner.id)).toMatchObject({ safetyBand: "teen_16_17", pathway: "ks4", safetyBandCheckedAt: firstOfDecember, independenceOfferedAt: null });

    // The learner is told in the app; the parent in the app and by email.
    expect(await noticesFor(learner.id)).toMatchObject([{ type: "account.birthday_transition", channel: "in_app" }]);
    const parentNotices = await noticesFor(parent.id);
    expect(parentNotices.map((n) => n.channel).sort()).toEqual(["email", "in_app"]);
    expect((parentNotices[0]?.payload as { title: string }).title).toBe("Maya's settings are changing");
    const emails = getSentEmails().filter((e) => e.template === "birthday_transition");
    expect(emails).toMatchObject([{ to: "priya@example.test" }]);
    expect(emails[0]?.text).toMatch(/16 to 17 age group/);
  });

  it("is safe to run twice: no second notice, no second change", async () => {
    const { family } = await createParent();
    const { user: learner } = await createLearner({ birthYear: 2010, birthMonth: 11, familyId: family.id, now: NOW });
    const december = { db, now: new Date("2026-12-01T00:10:00Z") };
    await recalculateBands(december);
    clearSentEmails();
    expect(await recalculateBands(december)).toMatchObject({ bandChanged: 0, independenceOffered: 0 });
    expect(await recalculateBands({ db, now: new Date("2026-12-02T00:10:00Z") })).toMatchObject({ bandChanged: 0 });
    expect(await noticesFor(learner.id)).toHaveLength(1);
    expect(getSentEmails()).toHaveLength(0);
  });

  it("recomputes the default pathway as the learner gets older", async () => {
    const { family } = await createParent();
    // Born May 2012: 14 (ks3) in November 2026, 15 (ks4) from June 2027.
    const { user: learner } = await createLearner({ birthYear: 2012, birthMonth: 5, familyId: family.id, now: NOW });
    expect(await profileOf(learner.id)).toMatchObject({ pathway: "ks3" });
    const result = await recalculateBands({ db, now: new Date("2027-06-01T00:10:00Z") });
    expect(result).toMatchObject({ bandChanged: 0, pathwayChanged: 1 });
    expect(await profileOf(learner.id)).toMatchObject({ pathway: "ks4", safetyBand: "teen_13_15" });
    // A pathway change alone is not a birthday notice.
    expect(await noticesFor(learner.id)).toHaveLength(0);
  });

  it("at 18 moves the learner to adult_18 and offers independence, once", async () => {
    const { family, user: parent } = await createParent({ email: "priya@example.test" });
    // Born October 2008: 18 from 1 November 2026. Stored as 16–17 until the job runs.
    const { user: learner } = await createLearner({ birthYear: 2008, birthMonth: 10, familyId: family.id, nickname: "Josh", now: new Date("2026-10-15T10:00:00Z") });
    expect(await profileOf(learner.id)).toMatchObject({ safetyBand: "teen_16_17", independenceOfferedAt: null });
    // Before the job has run, the live reading is 18 but the stricter stored band still applies.
    expect((await actorFor(learner.id, NOW)).safetyBand).toBe("teen_16_17");

    const result = await recalculateBands({ db, now: NOW });
    expect(result).toMatchObject({ bandChanged: 1, independenceOffered: 1 });
    expect(await profileOf(learner.id)).toMatchObject({ safetyBand: "adult_18", pathway: "sixth_form", independenceOfferedAt: NOW });
    expect((await actorFor(learner.id, NOW)).safetyBand).toBe("adult_18");

    const learnerNotice = (await noticesFor(learner.id))[0];
    expect(learnerNotice?.payload).toMatchObject({ title: "You're 18: your account, your call", href: "/settings/independence" });
    expect((learnerNotice?.payload as { body: string }).body).toMatch(/Nothing changes unless you choose to/);
    const parentEmail = getSentEmails().find((e) => e.template === "birthday_transition");
    expect(parentEmail?.to).toBe("priya@example.test");
    expect(parentEmail?.text).toMatch(/Nothing changes unless they decide/);
    expect(await noticesFor(parent.id)).not.toHaveLength(0);

    // Nothing else changed: still in the parent's family, still no email of their own.
    expect(await isIndependentLearner({ db, now: NOW }, learner.id)).toBe(false);
    expect((await db.select().from(familyMember).where(eq(familyMember.userId, learner.id)))[0]?.familyId).toBe(family.id);

    const again = await recalculateBands({ db, now: new Date("2026-11-17T00:10:00Z") });
    expect(again).toMatchObject({ bandChanged: 0, independenceOffered: 0 });
    expect(await noticesFor(learner.id)).toHaveLength(1);
  });

  it("does not offer independence to someone who already owns their own family", async () => {
    const { user: adult } = await createLearner({ age: 18, now: NOW });
    const families = await db.insert(familyTable).values({ ownerUserId: adult.id, plan: "free" }).returning();
    await db.insert(familyMember).values({ familyId: families[0]?.id ?? "", userId: adult.id, role: "learner" });
    expect(await recalculateBands({ db, now: NOW })).toMatchObject({ checked: 1, independenceOffered: 0 });
    expect(await profileOf(adult.id)).toMatchObject({ independenceOfferedAt: null });
  });

  it("leaves a profile alone if its birth date now gives an age under 13, and counts it for a person to look at", async () => {
    const { user: learner } = await createLearner({ age: 13, now: NOW });
    await db.update(learnerProfile).set({ birthYear: 2016 }).where(eq(learnerProfile.userId, learner.id));
    expect(await recalculateBands({ db, now: NOW })).toMatchObject({ checked: 1, under13: 1, bandChanged: 0 });
    expect(await profileOf(learner.id)).toMatchObject({ safetyBand: "teen_13_15" });
  });

  it("skips deleted accounts", async () => {
    await createLearner({ age: 14, status: "deleted", now: NOW });
    expect(await recalculateBands({ db, now: NOW })).toMatchObject({ checked: 0 });
  });
});

describe("independence at 18", () => {
  /** An 18-year-old in a parent's family, with the parent's consents in place. */
  async function eighteenInFamily() {
    const { actor: parent, family, user: parentUser } = await createParent({ email: "priya@example.test" });
    const { user: learner } = await createLearner({ age: 18, familyId: family.id, nickname: "Josh", username: "calm_falcon_30", password: TEST_PASSWORD, now: NOW });
    await saveConsents(testCtx(parent, { now: NOW }), learner.id, { choices: { ...REQUIRED_TICKED, tutor_history_retention: true } });
    const actor = await actorFor(learner.id, NOW);
    return { parent, parentUser, family, learnerId: learner.id, actor, ctx: testCtx(actor, { now: NOW }) };
  }

  /** The token from the confirmation email. */
  function emailedToken(): string {
    const email = getSentEmails().filter((e) => e.template === "independence_confirm_email").pop();
    const match = /independence\?token=([A-Za-z0-9_%-]+)/.exec(email?.text ?? "");
    if (!match?.[1]) throw new Error("No confirmation link in the email");
    return decodeURIComponent(match[1]);
  }

  it("is refused for anyone under 18", async () => {
    const { family } = await createParent();
    const { actor } = await createLearner({ age: 17, familyId: family.id, now: NOW });
    const ctx = testCtx(actor, { now: NOW });
    expect(await getIndependenceState(ctx)).toMatchObject({ eligible: false, independent: false, parentLinked: true });
    await expect(requestIndependence(ctx, { email: "teen@example.test" })).rejects.toMatchObject({ code: "age_restricted" });
    await expect(confirmIndependence(ctx, { token: "x", consents: REQUIRED_TICKED, parentLink: "remove" })).rejects.toMatchObject({ code: "age_restricted" });
    expect(getSentEmails()).toHaveLength(0);
  });

  it("asking changes nothing: the address waits in a short-lived record until the emailed link is used", async () => {
    const { ctx, learnerId, family } = await eighteenInFamily();
    expect(await getIndependenceState(ctx)).toEqual({ eligible: true, independent: false, ownsFamily: false, parentLinked: true, awaitingEmail: false });

    await requestIndependence(ctx, { email: " Josh@Example.test " });
    expect(getSentEmails().filter((e) => e.template === "independence_confirm_email")).toMatchObject([{ to: "josh@example.test" }]);
    expect(await getIndependenceState(ctx)).toMatchObject({ independent: false, awaitingEmail: true, parentLinked: true });

    // Nothing on the account has changed.
    expect((await userRow(learnerId))?.email).toMatch(/@learner\.invalid$/);
    expect((await db.select().from(familyMember).where(eq(familyMember.userId, learnerId)))[0]?.familyId).toBe(family.id);
    expect(await isIndependentLearner({ db, now: NOW }, learnerId)).toBe(false);
    // Only a hash of the token is kept.
    const stored = (await db.select().from(verification))[0];
    expect(stored?.value).not.toContain(emailedToken());
  });

  it("confirming with 'remove' gives them their own verified email and their own single-seat family", async () => {
    const { ctx, learnerId, family, parent, parentUser } = await eighteenInFamily();
    await createParentControl({ learnerId, familyId: family.id, dailyMinutesCap: 60 });
    await createInviteCode({ familyId: family.id, learnerId });
    await requestIndependence(ctx, { email: "josh@example.test" });

    const result = await confirmIndependence(ctx, { token: emailedToken(), consents: { ...REQUIRED_TICKED, tutor_history_retention: false }, parentLink: "remove" });
    expect(result.parentLinkRemoved).toBe(true);
    expect(result.familyId).not.toBe(family.id);
    expectNoPlaceholderEmail(result);

    expect(await userRow(learnerId)).toMatchObject({ email: "josh@example.test", emailVerified: true, kind: "learner", status: "active" });
    const own = await getFamily({ db }, result.familyId ?? "");
    expect(own).toMatchObject({ ownerUserId: learnerId, ownerKind: "learner", plan: "free", ownerEmailVerified: true });
    expect(await db.select().from(familyMember).where(eq(familyMember.familyId, result.familyId ?? ""))).toMatchObject([{ userId: learnerId, role: "learner", addedBy: null }]);
    // Gone from the parent's family: the parent no longer sees them and the seat is free.
    expect(await listChildren({ db, now: NOW }, family.id)).toEqual([]);
    // The parent's limits ended with the link; unused invite codes are switched off.
    expect(await db.select().from(parentControl).where(eq(parentControl.learnerId, learnerId))).toHaveLength(0);
    expect((await db.select().from(inviteCode).where(eq(inviteCode.learnerId, learnerId)))[0]?.revokedAt).not.toBeNull();

    // The consents are now their own, recorded afresh in their name; the optional one they declined is withdrawn.
    const records = await db.select().from(consentRecord).where(and(eq(consentRecord.learnerId, learnerId), eq(consentRecord.method, "independence")));
    expect(records.filter((r) => r.action === "granted").map((r) => r.consentKey).sort()).toEqual(["account_learning_data", "ai_processing", "third_party_tools"]);
    expect(records.filter((r) => r.action === "revoked").map((r) => r.consentKey)).toEqual(["tutor_history_retention"]);
    expect(records.every((r) => r.actorUserId === learnerId && r.familyId === result.familyId)).toBe(true);

    expect(await getIndependenceState(testCtx(await actorFor(learnerId, NOW), { now: NOW }))).toEqual({ eligible: true, independent: true, ownsFamily: true, parentLinked: false, awaitingEmail: false });
    expect(await isIndependentLearner({ db, now: NOW }, learnerId)).toBe(true);
    expect(await db.select().from(verification)).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "independence.confirm"))).toMatchObject([{ meta: { parentLink: "removed" } }]);

    // The parent is told, and can no longer manage the account.
    const notice = (await noticesFor(parentUser.id)).find((n) => n.type === "account.independence");
    expect((notice?.payload as { body: string }).body).toMatch(/left your family/);
    await expect(resetChildPassword(testCtx(parent, { now: NOW }), learnerId, { password: "meadow-kettle-comet-77" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveConsents(testCtx(parent, { now: NOW }), learnerId, { choices: { tutor_history_retention: true } })).rejects.toMatchObject({ code: "forbidden" });

    // They still sign in with the same username and password, and can now reset it by email themselves.
    expect((await getAuth().api.signInUsername({ body: { username: "calm_falcon_30", password: TEST_PASSWORD } }))?.token).toBeTruthy();
  });

  it("confirming with 'keep' leaves them in the parent's family, but the account is theirs to run", async () => {
    const { ctx, learnerId, family, parent, parentUser } = await eighteenInFamily();
    await requestIndependence(ctx, { email: "josh@example.test" });
    const result = await confirmIndependence(ctx, { token: emailedToken(), consents: REQUIRED_TICKED, parentLink: "keep" });
    expect(result).toEqual({ familyId: family.id, parentLinkRemoved: false });

    const state = await getIndependenceState(testCtx(await actorFor(learnerId, NOW), { now: NOW }));
    expect(state).toMatchObject({ independent: true, ownsFamily: false, parentLinked: true });
    expect((await listChildren({ db, now: NOW }, family.id)).map((c) => c.learnerId)).toEqual([learnerId]);
    await expect(resetChildPassword(testCtx(parent, { now: NOW }), learnerId, { password: "meadow-kettle-comet-77" })).rejects.toThrow(/runs their own account now/);
    expect(((await noticesFor(parentUser.id)).find((n) => n.type === "account.independence")?.payload as { body: string }).body).toMatch(/stay linked/);

    // Later they can remove the link.
    const later = await removeParentLink(testCtx(await actorFor(learnerId, NOW), { now: NOW }));
    expect(later.familyId).not.toBe(family.id);
    expect(await listChildren({ db, now: NOW }, family.id)).toEqual([]);
    expect(await getFamily({ db }, later.familyId)).toMatchObject({ ownerUserId: learnerId });
    await expect(removeParentLink(testCtx(await actorFor(learnerId, NOW), { now: NOW }))).rejects.toMatchObject({ code: "conflict" });
  });

  it("needs their own agreement to every required consent, and changes nothing without it", async () => {
    const { ctx, learnerId, family } = await eighteenInFamily();
    await requestIndependence(ctx, { email: "josh@example.test" });
    const attempt = confirmIndependence(ctx, { token: emailedToken(), consents: { account_learning_data: true, ai_processing: true }, parentLink: "remove" });
    await expect(attempt).rejects.toMatchObject({ code: "consent_required", fieldErrors: { "consent.third_party_tools": expect.any(Array) } });
    expect((await userRow(learnerId))?.email).toMatch(/@learner\.invalid$/);
    expect((await db.select().from(familyMember).where(eq(familyMember.userId, learnerId)))[0]?.familyId).toBe(family.id);
  });

  it("refuses a wrong, replaced or expired link", async () => {
    const { ctx, learnerId, actor } = await eighteenInFamily();
    await requestIndependence(ctx, { email: "josh@example.test" });
    const first = emailedToken();
    const input = { consents: REQUIRED_TICKED, parentLink: "remove" as const };
    await expect(confirmIndependence(ctx, { ...input, token: "not-the-token" })).rejects.toMatchObject({ code: "invalid_input" });

    // Asking again replaces the link.
    await requestIndependence(ctx, { email: "josh.new@example.test" });
    await expect(confirmIndependence(ctx, { ...input, token: first })).rejects.toMatchObject({ code: "invalid_input" });

    // The link lasts 24 hours.
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await expect(confirmIndependence(testCtx(actor, { now: tomorrow }), { ...input, token: emailedToken() })).rejects.toMatchObject({ code: "invalid_input" });
    expect((await userRow(learnerId))?.email).toMatch(/@learner\.invalid$/);

    await expect(confirmIndependence(ctx, { ...input, token: emailedToken() })).resolves.toMatchObject({ parentLinkRemoved: true });
    expect((await userRow(learnerId))?.email).toBe("josh.new@example.test");
  });

  it("refuses an address that already belongs to another account, and rolls everything back", async () => {
    const { ctx, learnerId, family } = await eighteenInFamily();
    await requestIndependence(ctx, { email: "priya@example.test" }); // the parent's own address
    const attempt = confirmIndependence(ctx, { token: emailedToken(), consents: REQUIRED_TICKED, parentLink: "remove" });
    await expect(attempt).rejects.toMatchObject({ code: "conflict" });
    await expect(attempt).rejects.toThrow(/already used by another account/);
    expect((await userRow(learnerId))?.email).toMatch(/@learner\.invalid$/);
    expect((await db.select().from(familyMember).where(eq(familyMember.userId, learnerId)))[0]?.familyId).toBe(family.id);
    expect(await db.select().from(familyTable)).toHaveLength(1);
    expect(await db.select().from(consentRecord).where(eq(consentRecord.method, "independence"))).toHaveLength(0);
  });

  it("another learner's link is no use, and a parent or a visitor cannot do any of this", async () => {
    const { ctx, parent, family } = await eighteenInFamily();
    await requestIndependence(ctx, { email: "josh@example.test" });
    const token = emailedToken();
    const { user: other } = await createLearner({ age: 18, familyId: family.id, now: NOW });
    const otherCtx = testCtx(await actorFor(other.id, NOW), { now: NOW });
    await expect(confirmIndependence(otherCtx, { token, consents: REQUIRED_TICKED, parentLink: "remove" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(requestIndependence(testCtx(parent, { now: NOW }), { email: "x@example.test" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getIndependenceState(testCtx(undefined, { now: NOW }))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("leaving the family lifts a parent's pause, since nobody would be left who could", async () => {
    const { ctx, learnerId, family, actor } = await eighteenInFamily();
    await requestIndependence(ctx, { email: "josh@example.test" });
    const token = emailedToken();
    await createParentControl({ learnerId, familyId: family.id, paused: true, pausedReason: "Exams" });
    await db.update(user).set({ status: "paused", statusReason: "parent_pause" }).where(eq(user.id, learnerId));

    const pausedCtx = testCtx({ ...actor, status: "paused" }, { now: NOW });
    await confirmIndependence(pausedCtx, { token, consents: REQUIRED_TICKED, parentLink: "remove" });
    expect(await userRow(learnerId)).toMatchObject({ status: "active", statusReason: null });
  });

  it("staying linked leaves a parent's pause in place", async () => {
    const { ctx, learnerId, family, actor } = await eighteenInFamily();
    await requestIndependence(ctx, { email: "josh@example.test" });
    const token = emailedToken();
    await createParentControl({ learnerId, familyId: family.id, paused: true });
    await db.update(user).set({ status: "paused", statusReason: "parent_pause" }).where(eq(user.id, learnerId));
    await confirmIndependence(testCtx({ ...actor, status: "paused" }, { now: NOW }), { token, consents: REQUIRED_TICKED, parentLink: "keep" });
    expect(await userRow(learnerId)).toMatchObject({ status: "paused", statusReason: "parent_pause" });
    expect(CONSENT_HOLD.required).toBe("consent_required");
  });
});
