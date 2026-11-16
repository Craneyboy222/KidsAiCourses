import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { assertCan, can } from "@/server/authz";
import type { LearnerActor } from "@/server/authz/actor";
import { loadActor, systemCtx } from "@/server/context";
import { auditLog, consentRecord, family, familyMember, learnerProfile, notification, parentLinkRequest, user } from "@/server/db/schema";
import { clearSentEmails, getSentEmails } from "@/server/email";
import { accountsPurgePending } from "@/server/jobs/accounts";
import { JOBS } from "@/server/jobs/registry";
import { notify } from "@/server/notifications";
import { approveTeen, createParentForApproval, declineTeen, getApprovalRequest } from "@/server/services/approve-teen";
import { CONSENT_HOLD, getConsentCentre, missingRequiredConsents, saveConsents } from "@/server/services/consent";
import { getLearnerSummary } from "@/server/services/family";
import { saveInterests } from "@/server/services/onboarding";
import { MAX_APPROVAL_EMAILS, PENDING_TEEN_DAYS, erasePendingTeen, getPendingTeenStatus, purgePendingTeens, resendParentApproval, signUpTeen } from "@/server/services/teen-signup";
import { setSetting } from "@/server/settings";
import { closeDb, db, testCtx } from "../../helpers/db";
import { TEST_PASSWORD, createLearner, createParent } from "../../helpers/factories";
import { NOW, REQUIRED_TICKED, addSession, birthFor, countRows, daysFrom, expectNoPlaceholderEmail, freshAccountsDb, mockedEntitlement, plan, sessionCount, snapshot, userRow } from "./helpers";

vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));

beforeEach(async () => {
  await freshAccountsDb();
});
afterAll(async () => {
  await closeDb();
});

const anon = (now: Date = NOW) => testCtx(undefined, { now });
const teenInput = (over: Record<string, unknown> = {}) => ({ ...birthFor(14), username: "pixel_wren_77", password: TEST_PASSWORD, parentEmail: "Priya@Example.test", ...over });

/** The approval token from the most recent email to the parent. */
function latestToken(): string {
  const emails = getSentEmails().filter((email) => email.template === "parent_approval_request");
  const text = emails[emails.length - 1]?.text ?? "";
  const match = /\/approve\/([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error("No approval link in the email");
  return match[1];
}

async function pendingTeen(over: Record<string, unknown> = {}) {
  const result = await signUpTeen(anon(), teenInput(over));
  const actor = (await loadActor(db, { userId: result.learnerId, createdAt: NOW, twoFactorVerified: false }, NOW)) as LearnerActor;
  return { ...result, actor, token: latestToken() };
}

describe("teen-first sign-up", () => {
  it("creates a locked, pending account and emails the parent a link that lasts 7 days", async () => {
    const result = await signUpTeen(anon(), teenInput());
    expect(result).toMatchObject({ username: "pixel_wren_77" });
    expect(result.expiresAt.getTime()).toBe(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    expectNoPlaceholderEmail(result);

    expect(await userRow(result.learnerId)).toMatchObject({ kind: "learner", status: "pending_parent", username: "pixel_wren_77" });
    expect(await db.select().from(familyMember)).toHaveLength(0);
    const request = (await db.select().from(parentLinkRequest))[0];
    expect(request).toMatchObject({ learnerId: result.learnerId, parentEmail: "priya@example.test", status: "pending", sendCount: 1 });

    const emails = getSentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: "priya@example.test", template: "parent_approval_request" });
    // Only a hash of the token is stored.
    const token = latestToken();
    expect(token.length).toBeGreaterThan(30);
    expect(request?.tokenHash).not.toBe(token);
    expect(JSON.stringify(request)).not.toContain(token);
    // The email says when the request runs out.
    expect(emails[0]?.text).toMatch(/23 November 2026/);
  });

  it("writes nothing to the audit log about a pending teen, because the account may vanish without trace", async () => {
    const before = await countRows("audit_log");
    await signUpTeen(anon(), teenInput());
    expect(await countRows("audit_log")).toBe(before);
  });

  it("never asks for or stores an email address for the teen", async () => {
    const { learnerId } = await signUpTeen(anon(), teenInput());
    expect((await userRow(learnerId))?.email).toMatch(/@learner\.invalid$/);
    expect((await db.select().from(learnerProfile))[0]).toMatchObject({ firstName: null, nickname: "pixel_wren_77" });
  });

  it("lets the teen sign in, but a pending account cannot use Coach, save work or earn a certificate", async () => {
    const { actor, learnerId } = await pendingTeen();
    expect((await getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: TEST_PASSWORD } }))?.token).toBeTruthy();
    expect(actor).toMatchObject({ type: "learner", status: "pending_parent", familyId: null });

    const own = { learnerId };
    for (const action of ["learner.coach.chat", "learner.progress.write", "learner.submission.create", "learner.course.start", "learner.quiz.attempt", "learner.wishlist.write", "learner.profile.update"] as const) {
      expect(can(actor, action, own), action).toBe(false);
    }
    expect(() => assertCan(actor, "learner.coach.chat", own)).toThrowError(expect.objectContaining({ code: "paused" }));
    // Onboarding writes are refused too.
    await expect(saveInterests(testCtx(actor, { now: NOW }), ["music", "games", "apps"])).rejects.toMatchObject({ code: "paused" });
    // They may still look at the public catalogue and see their own waiting status.
    expect(can(actor, "public.catalogue.read", own)).toBe(true);
    expect(can(actor, "learner.parent_link.resend", own)).toBe(true);
  });

  it("tells the waiting teen when the account will be deleted, and never the parent's address", async () => {
    const { actor } = await pendingTeen();
    const status = await getPendingTeenStatus(testCtx(actor, { now: NOW }));
    expect(status).toEqual({ pending: true, expiresAt: daysFrom(NOW, 7), emailsSent: 1, canResend: true });
    expect(JSON.stringify(status)).not.toMatch(/priya|example\.test/i);
    expect(PENDING_TEEN_DAYS).toBe(7);
  });

  it("removes the account again if the email to the parent cannot be sent", async () => {
    const before = await snapshot(["user", "learner_profile", "parent_link_request", "account"]);
    // `.invalid` can never be delivered; the service refuses it before creating anything.
    await expect(signUpTeen(anon(), teenInput({ parentEmail: "mum@home.invalid" }))).rejects.toMatchObject({ code: "invalid_input", fieldErrors: { parentEmail: expect.any(Array) } });
    // An address the email system refuses after the account exists: the teen's own (under-18) address is one.
    const { user: other } = await createLearner({ age: 18, now: NOW });
    await db.update(user).set({ email: "teen@example.test" }).where(eq(user.id, other.id));
    await db.update(learnerProfile).set({ safetyBand: "teen_16_17" }).where(eq(learnerProfile.userId, other.id));
    const mid = await snapshot(["user", "learner_profile", "parent_link_request", "account"]);
    await expect(signUpTeen(anon(), teenInput({ parentEmail: "teen@example.test" }))).rejects.toMatchObject({ code: "invalid_input" });
    expect(await snapshot(["user", "learner_profile", "parent_link_request", "account"])).toEqual(mid);
    expect(before.parent_link_request).toBe(0);
  });

  it("limits how many requests can be sent to one parent's address in a day", async () => {
    for (let i = 0; i < 3; i++) await signUpTeen(anon(), teenInput({ username: `pixel_wren_${70 + i}` }));
    await expect(signUpTeen(anon(), teenInput({ username: "pixel_wren_99" }))).rejects.toMatchObject({ code: "rate_limited" });
    expect(await db.select().from(parentLinkRequest)).toHaveLength(3);
  });

  it("sends an 18-year-old to the adult sign-up when that is switched on, and through a parent when it is not", async () => {
    await expect(signUpTeen(anon(), teenInput({ ...birthFor(18) }))).rejects.toMatchObject({ code: "invalid_input" });
    await setSetting(systemCtx("seed"), "site.adult_self_serve", false);
    await expect(signUpTeen(anon(), teenInput({ ...birthFor(18) }))).resolves.toMatchObject({ username: "pixel_wren_77" });
  });

  it("can resend the email twice more; each new link replaces the last and the deadline does not move", async () => {
    const { actor, token: first } = await pendingTeen();
    const ctx = testCtx(actor, { now: daysFrom(NOW, 1) });
    expect(await resendParentApproval(ctx)).toEqual({ emailsSent: 2 });
    const second = latestToken();
    expect(second).not.toBe(first);
    expect(await getApprovalRequest(anon(), first)).toEqual({ state: "unknown" });
    expect(await getApprovalRequest(anon(), second)).toMatchObject({ state: "pending", expiresAt: daysFrom(NOW, 7) });

    expect(await resendParentApproval(ctx)).toEqual({ emailsSent: MAX_APPROVAL_EMAILS });
    await expect(resendParentApproval(ctx)).rejects.toMatchObject({ code: "rate_limited" });
    expect((await getPendingTeenStatus(ctx)).canResend).toBe(false);
    expect(getSentEmails().filter((e) => e.template === "parent_approval_request")).toHaveLength(3);
  });
});

describe("purging unapproved accounts", () => {
  it("is registered as a daily job", () => {
    const job = JOBS.find((j) => j.name === "accounts.purge_pending");
    expect(job?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(JOBS.find((j) => j.name === "accounts.recalculate_bands")?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("leaves a pending account alone for 7 days", async () => {
    const { learnerId } = await pendingTeen();
    expect(await purgePendingTeens({ db, now: daysFrom(NOW, 6.99) })).toEqual({ purged: 0 });
    expect(await userRow(learnerId)).toBeDefined();
  });

  it("after 7 days deletes everything about the account and leaves no rows", async () => {
    const tables = ["user", "learner_profile", "parent_link_request", "account", "session", "family_member", "notification", "consent_record", "invite_code"];
    const audits = await countRows("audit_log");
    const before = await snapshot(tables);

    const { learnerId, actor } = await pendingTeen();
    await addSession(learnerId);
    await notify({ db, now: NOW }, { userId: learnerId, type: "test.notice", title: "Hello", body: "A notice for the waiting teen." });
    await resendParentApproval(testCtx(actor, { now: NOW })); // leaves a rate-limit-free trace of activity
    await db.insert(auditLog).values({ actorType: "learner", actorId: learnerId, action: "test.something", targetType: "user", targetId: learnerId });
    expect(await countRows("learner_profile")).toBe(1);

    const result = await accountsPurgePending.run(systemCtx("accounts.purge_pending", { now: daysFrom(NOW, 7) }), undefined as never);
    expect(result).toEqual({ purged: 1 });

    expect(await snapshot(tables)).toEqual(before);
    expect(await countRows("audit_log")).toBe(audits);
    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, learnerId))).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.actorId, learnerId))).toHaveLength(0);
    expect(await sessionCount(learnerId)).toBe(0);
    // The username is free again and the old password opens nothing.
    await expect(getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: TEST_PASSWORD } })).rejects.toBeDefined();

    // Running it again finds nothing.
    expect(await purgePendingTeens({ db, now: daysFrom(NOW, 8) })).toEqual({ purged: 0 });
  });

  it("never touches an approved teen, an active learner or a parent", async () => {
    const { family: fam, actor: parent } = await createParent({ email: "priya@example.test" });
    const { user: active } = await createLearner({ familyId: fam.id });
    const { learnerId, token } = await pendingTeen();
    await approveTeen(testCtx(parent, { now: daysFrom(NOW, 1) }), token);

    expect(await purgePendingTeens({ db, now: daysFrom(NOW, 30) })).toEqual({ purged: 0 });
    expect(await userRow(learnerId)).toMatchObject({ status: "paused" });
    expect(await userRow(active.id)).toMatchObject({ status: "active" });
    expect(await userRow(parent.userId)).toBeDefined();
  });

  it("erasePendingTeen refuses to erase anything about an account that is no longer pending", async () => {
    const { family: fam, actor: parent } = await createParent({ email: "priya@example.test" });
    const { learnerId, token } = await pendingTeen();
    await approveTeen(testCtx(parent, { now: NOW }), token);
    await saveConsents(testCtx(parent, { now: NOW }), learnerId, { choices: REQUIRED_TICKED });
    const records = await countRows("consent_record");
    const audits = await countRows("audit_log");

    // Regression: the consent and audit records of an approved learner used to be deleted here.
    expect(await erasePendingTeen({ db }, learnerId)).toBe(false);
    expect(await countRows("consent_record")).toBe(records);
    expect(await countRows("audit_log")).toBe(audits);
    expect(await userRow(learnerId)).toMatchObject({ status: "active" });
    expect(fam.id).toBeTruthy();
  });
});

describe("a parent approves", () => {
  it("the page shows the teen's username and whether to sign in or create an account", async () => {
    const { token } = await pendingTeen();
    const view = await getApprovalRequest(anon(), token);
    expect(view).toEqual({ state: "pending", username: "pixel_wren_77", expiresAt: daysFrom(NOW, 7), parentAccountExists: false });
    expectNoPlaceholderEmail(view);
    expect(JSON.stringify(view)).not.toMatch(/priya/i);

    await createParent({ email: "priya@example.test" });
    expect(await getApprovalRequest(anon(), token)).toMatchObject({ state: "pending", parentAccountExists: true });
    expect(await getApprovalRequest(anon(), "made-up-token")).toEqual({ state: "unknown" });
    expect(await getApprovalRequest(anon(), "")).toEqual({ state: "unknown" });
    expect(await getApprovalRequest(anon(daysFrom(NOW, 7)), token)).toEqual({ state: "expired" });
  });

  it("a new parent creates an account for the address the link was sent to, already verified, with a family", async () => {
    const { token } = await pendingTeen();
    const created = await createParentForApproval(anon(), token, { password: "meadow-kettle-comet-77", name: "Priya", confirmedAdult: true });
    expect(created.email).toBe("priya@example.test");
    expect(await userRow(created.userId)).toMatchObject({ kind: "parent", email: "priya@example.test", emailVerified: true, status: "active" });
    expect(await db.select().from(family).where(eq(family.id, created.familyId))).toMatchObject([{ ownerUserId: created.userId }]);
    // Nothing is approved yet.
    expect((await db.select().from(parentLinkRequest))[0]?.status).toBe("pending");
    // They can sign in straight away with the password they chose.
    expect((await getAuth().api.signInEmail({ body: { email: "priya@example.test", password: "meadow-kettle-comet-77" } }))?.token).toBeTruthy();

    await expect(createParentForApproval(anon(), token, { password: "meadow-kettle-comet-77", confirmedAdult: true })).rejects.toMatchObject({ code: "conflict" });
    await expect(createParentForApproval(anon(), "bad-token", { password: "meadow-kettle-comet-77", confirmedAdult: true })).rejects.toMatchObject({ code: "not_found" });
  });

  it("needs the 18+ declaration to create the parent account", async () => {
    const { token } = await pendingTeen();
    await expect(createParentForApproval(anon(), token, { password: "meadow-kettle-comet-77", confirmedAdult: false })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await db.select().from(user).where(eq(user.kind, "parent"))).toHaveLength(0);
  });

  it("approval links the teen to the family, but the account stays held until consent is complete", async () => {
    const { actor: parent, family: fam } = await createParent({ email: "priya@example.test" });
    const { learnerId, token } = await pendingTeen();
    await addSession(learnerId);

    const result = await approveTeen(testCtx(parent, { now: NOW }), token);
    expect(result).toEqual({ learnerId, familyId: fam.id });
    expect(await db.select().from(familyMember).where(eq(familyMember.userId, learnerId))).toMatchObject([{ familyId: fam.id, role: "learner", addedBy: parent.userId }]);
    expect((await db.select().from(parentLinkRequest))[0]).toMatchObject({ status: "approved", resolvedBy: parent.userId, resolvedAt: NOW });

    // Not active yet: approval alone is not consent.
    expect(await userRow(learnerId)).toMatchObject({ status: "paused", statusReason: CONSENT_HOLD.required });
    expect(await missingRequiredConsents({ db }, learnerId)).toEqual(["account_learning_data", "ai_processing", "third_party_tools"]);
    const held = (await loadActor(db, { userId: learnerId, createdAt: NOW, twoFactorVerified: false }, NOW)) as LearnerActor;
    expect(can(held, "learner.coach.chat", { learnerId })).toBe(false);

    // Two of three is still not enough.
    const ctx = testCtx(parent, { now: NOW });
    const partial = await saveConsents(ctx, learnerId, { choices: { account_learning_data: true, ai_processing: true }, method: "teen_approval" });
    expect(partial).toMatchObject({ status: "paused", activated: false, missingRequired: ["third_party_tools"] });
    expect(await userRow(learnerId)).toMatchObject({ status: "paused" });

    // The third makes the account active.
    const done = await saveConsents(ctx, learnerId, { choices: { third_party_tools: true }, method: "teen_approval" });
    expect(done).toMatchObject({ status: "active", activated: true, missingRequired: [] });
    expect(await userRow(learnerId)).toMatchObject({ status: "active", statusReason: null });
    const active = (await loadActor(db, { userId: learnerId, createdAt: NOW, twoFactorVerified: false }, NOW)) as LearnerActor;
    expect(active).toMatchObject({ status: "active", familyId: fam.id });
    expect(can(active, "learner.coach.chat", { learnerId })).toBe(true);
    // The teen is told in the app.
    expect(await db.select().from(notification).where(eq(notification.userId, learnerId))).toMatchObject([{ type: "account.ready", channel: "in_app" }]);
    expect((await getConsentCentre(ctx, learnerId)).complete).toBe(true);
    expect((await getLearnerSummary(ctx, learnerId)).familyId).toBe(fam.id);
  });

  it("respects the plan's seat limit", async () => {
    plan.seats = 1;
    const { actor: parent, family: fam } = await createParent({ email: "priya@example.test" });
    await createLearner({ familyId: fam.id });
    const { learnerId, token } = await pendingTeen();
    await expect(approveTeen(testCtx(parent, { now: NOW }), token)).rejects.toMatchObject({ code: "entitlement_required" });
    expect(await userRow(learnerId)).toMatchObject({ status: "pending_parent" });
    expect((await db.select().from(parentLinkRequest))[0]?.status).toBe("pending");

    plan.seats = 2;
    await expect(approveTeen(testCtx(parent, { now: NOW }), token)).resolves.toMatchObject({ learnerId });
  });

  it("can only be done once, by a signed-in parent, before the link runs out", async () => {
    const { actor: parent } = await createParent({ email: "priya@example.test" });
    const other = await createParent();
    const { token, actor: teen } = await pendingTeen();

    await expect(approveTeen(anon(), token)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(approveTeen(testCtx(teen, { now: NOW }), token)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(approveTeen(testCtx(parent, { now: daysFrom(NOW, 7) }), token)).rejects.toMatchObject({ code: "conflict" });
    await expect(approveTeen(testCtx(parent, { now: NOW }), "wrong-token")).rejects.toMatchObject({ code: "not_found" });

    await approveTeen(testCtx(parent, { now: NOW }), token);
    await expect(approveTeen(testCtx(other.actor, { now: NOW }), token)).rejects.toMatchObject({ code: "conflict" });
    expect(await db.select().from(familyMember).where(eq(familyMember.role, "learner"))).toHaveLength(1);
    expect(await getApprovalRequest(anon(), token)).toMatchObject({ state: "approved" });
  });

  it("declining deletes the pending account at once, with everything about it", async () => {
    const { learnerId, token } = await pendingTeen();
    await declineTeen(anon(), token);
    expect(await userRow(learnerId)).toBeUndefined();
    expect(await db.select().from(parentLinkRequest)).toHaveLength(0);
    expect(await db.select().from(learnerProfile)).toHaveLength(0);
    expect(await db.select().from(consentRecord)).toHaveLength(0);
    await expect(declineTeen(anon(), token)).rejects.toMatchObject({ code: "not_found" });
    clearSentEmails();
  });
});
