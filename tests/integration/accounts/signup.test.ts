import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthEmailSender, setAuthEmailSender, type AuthEmail } from "@/server/auth/email";
import { account, consentRecord, family, familyMember, learnerProfile, user } from "@/server/db/schema";
import { addChild } from "@/server/services/children";
import {
  AGE_GATE_COOKIE,
  AGE_GATE_COOKIE_MAX_AGE_SEC,
  assertOldEnough,
  assertUsernameAllowed,
  checkSignupOpen,
  signUpAdultLearner,
  signUpParent,
  signupRouteForBirth,
  suggestAvailableUsernames,
} from "@/server/services/signup";
import { signUpTeen } from "@/server/services/teen-signup";
import { setSetting } from "@/server/settings";
import { systemCtx } from "@/server/context";
import { closeDb, db, testCtx } from "../../helpers/db";
import { TEST_PASSWORD, createLearner, createParent } from "../../helpers/factories";
import {
  NOW,
  REQUIRED_TICKED,
  birthFor,
  counterTotal,
  expectNoPlaceholderEmail,
  freshAccountsDb,
  mockedEntitlement,
  snapshot,
} from "./helpers";

vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));

let authEmails: AuthEmail[] = [];

beforeEach(async () => {
  await freshAccountsDb();
  authEmails = [];
  setAuthEmailSender(async (email) => {
    authEmails.push(email);
  });
});
afterEach(() => resetAuthEmailSender());
afterAll(async () => {
  await closeDb();
});

const anon = () => testCtx(undefined, { now: NOW });

describe("the under-13 block", () => {
  it("at teen sign-up writes nothing at all: only the anonymous counter moves", async () => {
    const before = await snapshot();
    const attempt = signUpTeen(anon(), { ...birthFor(12), username: "tiny_tiger_12", password: TEST_PASSWORD, parentEmail: "mum@example.test" });
    await expect(attempt).rejects.toMatchObject({ code: "age_blocked", status: 403 });

    expect(await snapshot()).toEqual(before);
    expect(await counterTotal("signup.under13_blocked")).toBe(1);
    expect(await counterTotal("signup.closed_attempt")).toBe(0);
  });

  it("at parent-add writes nothing about the child: only the anonymous counter moves", async () => {
    const { actor } = await createParent();
    const before = await snapshot();
    const attempt = addChild(testCtx(actor, { now: NOW }), { ...birthFor(11), nickname: "Bea", username: "bea_bakes_cakes", password: TEST_PASSWORD });
    await expect(attempt).rejects.toMatchObject({ code: "age_blocked" });

    expect(await snapshot()).toEqual(before);
    expect(await counterTotal("signup.under13_blocked")).toBe(1);
  });

  it("says nothing about the child in the error: no age, month, year, username or email", async () => {
    const error = await signUpTeen(anon(), { ...birthFor(9), username: "tiny_tiger", password: TEST_PASSWORD, parentEmail: "mum@example.test" }).catch((e: unknown) => e);
    const text = JSON.stringify({ ...(error as object), message: (error as Error).message });
    expect(text).not.toMatch(/tiny_tiger|mum@example|2017|"age"|birth/i);
    expect((error as { detail?: unknown }).detail).toBeUndefined();
  });

  it("treats someone in their thirteenth-birthday month as still 12 (the younger reading)", async () => {
    // Born November 2013; it is November 2026.
    await expect(assertOldEnough(anon(), { birthYear: 2013, birthMonth: 11 })).rejects.toMatchObject({ code: "age_blocked" });
    await expect(assertOldEnough(testCtx(undefined, { now: new Date("2026-12-01T09:00:00Z") }), { birthYear: 2013, birthMonth: 11 })).resolves.toMatchObject({
      age: 13,
      safetyBand: "teen_13_15",
      pathway: "ks3",
    });
  });

  it("runs before anything typed into the form is checked", async () => {
    // Everything else about this request is invalid too; the age gate still answers first.
    const attempt = signUpTeen(anon(), { ...birthFor(12), username: "!", password: "x", parentEmail: "not-an-email" });
    await expect(attempt).rejects.toMatchObject({ code: "age_blocked" });
  });

  it("also guards the adult route and the route chooser, and counts each attempt", async () => {
    await expect(signupRouteForBirth(anon(), birthFor(12))).rejects.toMatchObject({ code: "age_blocked" });
    await expect(signUpAdultLearner(anon(), { ...birthFor(12), username: "tiny_tiger", email: "kid@example.test", password: TEST_PASSWORD, consents: REQUIRED_TICKED })).rejects.toMatchObject({
      code: "age_blocked",
    });
    expect(await counterTotal("signup.under13_blocked")).toBe(2);
    expect(await db.select().from(learnerProfile)).toHaveLength(0);
  });

  it("refuses a date that cannot be right without counting it as a child", async () => {
    await expect(assertOldEnough(anon(), { birthYear: 2011, birthMonth: 13 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(assertOldEnough(anon(), { birthYear: 1900, birthMonth: 1 })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await counterTotal("signup.under13_blocked")).toBe(0);
  });

  it("the retry cookie is a bare flag with a short life", () => {
    expect(AGE_GATE_COOKIE).toBe("age_gate");
    expect(AGE_GATE_COOKIE_MAX_AGE_SEC).toBeLessThanOrEqual(60 * 60);
  });
});

describe("sign-up while closed", () => {
  beforeEach(async () => {
    await setSetting(systemCtx("seed"), "site.signup_open", false);
  });

  it("refuses a parent, a teen, an adult learner and a new child, and counts each attempt", async () => {
    const { actor } = await createParent();
    const before = await snapshot(["user", "learner_profile", "parent_link_request", "family"]);

    await expect(signUpParent(anon(), { email: "new@example.test", password: TEST_PASSWORD, confirmedAdult: true })).rejects.toMatchObject({ code: "not_ready" });
    await expect(signUpTeen(anon(), { ...birthFor(14), username: "pixel_wren_77", password: TEST_PASSWORD, parentEmail: "mum@example.test" })).rejects.toMatchObject({ code: "not_ready" });
    await expect(signUpAdultLearner(anon(), { ...birthFor(18), username: "pixel_wren_78", email: "josh@example.test", password: TEST_PASSWORD, consents: REQUIRED_TICKED })).rejects.toMatchObject({
      code: "not_ready",
    });
    await expect(addChild(testCtx(actor, { now: NOW }), { ...birthFor(14), nickname: "Maya", username: "pixel_wren_79", password: TEST_PASSWORD })).rejects.toMatchObject({ code: "not_ready" });

    expect(await snapshot(["user", "learner_profile", "parent_link_request", "family"])).toEqual(before);
    expect(await counterTotal("signup.closed_attempt")).toBe(4);
    expect(authEmails).toEqual([]);
  });

  it("gives a friendly message and reports closed to the page", async () => {
    expect(await checkSignupOpen(anon())).toBe(false);
    const error = await signUpParent(anon(), { email: "new@example.test", confirmedAdult: true }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/not open for new sign-ups just yet/i);
  });

  it("still blocks an under-13 first, even while closed", async () => {
    await expect(signUpTeen(anon(), { ...birthFor(12), username: "tiny_tiger", password: TEST_PASSWORD, parentEmail: "mum@example.test" })).rejects.toMatchObject({ code: "age_blocked" });
    expect(await counterTotal("signup.under13_blocked")).toBe(1);
    expect(await counterTotal("signup.closed_attempt")).toBe(0);
  });
});

describe("parent sign-up", () => {
  it("creates the parent, a family they own and their membership, then emails a link to confirm the address", async () => {
    const result = await signUpParent(anon(), { email: "  Priya@Example.test ", password: TEST_PASSWORD, name: "Priya", confirmedAdult: true });
    expect(result.created).toBe(true);

    const parent = (await db.select().from(user).where(eq(user.id, result.userId ?? "")))[0];
    expect(parent).toMatchObject({ kind: "parent", email: "priya@example.test", emailVerified: false, status: "active", name: "Priya" });
    const families = await db.select().from(family);
    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({ id: result.familyId, ownerUserId: parent?.id, plan: "free", ageAssuranceLevel: "none" });
    expect(await db.select().from(familyMember)).toMatchObject([{ familyId: result.familyId, userId: parent?.id, role: "parent" }]);
    expect(await db.select().from(account).where(eq(account.userId, parent?.id ?? ""))).toHaveLength(1);

    expect(authEmails).toHaveLength(1);
    expect(authEmails[0]).toMatchObject({ kind: "verify_email", to: "priya@example.test" });
    expect(authEmails[0]?.url).toContain(encodeURIComponent("/signin/continue"));
  });

  it("works without a password, for parents who will sign in by emailed link", async () => {
    const result = await signUpParent(anon(), { email: "priya@example.test", confirmedAdult: true });
    expect(result.created).toBe(true);
    expect(await db.select().from(account)).toHaveLength(0);
    expect((await db.select().from(user))[0]?.name).toBe("Parent or carer");
  });

  it("needs the 18+ declaration", async () => {
    await expect(signUpParent(anon(), { email: "priya@example.test", password: TEST_PASSWORD, confirmedAdult: false })).rejects.toMatchObject({
      code: "invalid_input",
      fieldErrors: { confirmedAdult: expect.any(Array) },
    });
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("applies the password policy before anything is created", async () => {
    await expect(signUpParent(anon(), { email: "priya@example.test", password: "password123", confirmedAdult: true })).rejects.toMatchObject({
      code: "invalid_input",
      fieldErrors: { password: expect.any(Array) },
    });
    expect(await db.select().from(user)).toHaveLength(0);
    expect(await db.select().from(family)).toHaveLength(0);
  });

  it("looks the same from outside when the address already has an account, and creates nothing new", async () => {
    await createParent({ email: "priya@example.test" });
    const result = await signUpParent(anon(), { email: "PRIYA@example.test", password: TEST_PASSWORD, confirmedAdult: true });
    expect(result).toEqual({ created: false, userId: null, familyId: null });
    expect(await db.select().from(user)).toHaveLength(1);
    expect(await db.select().from(family)).toHaveLength(1);
    // Already confirmed: nothing is sent.
    expect(authEmails).toEqual([]);
  });

  it("sends the link again when the earlier sign-up was never confirmed", async () => {
    await signUpParent(anon(), { email: "priya@example.test", password: TEST_PASSWORD, confirmedAdult: true });
    const again = await signUpParent(anon(), { email: "priya@example.test", password: TEST_PASSWORD, confirmedAdult: true });
    expect(again.created).toBe(false);
    expect(authEmails.map((e) => e.kind)).toEqual(["verify_email", "verify_email"]);
    expect(await db.select().from(user)).toHaveLength(1);
  });

  it("refuses a learner placeholder address", async () => {
    await expect(signUpParent(anon(), { email: "abc@learner.invalid", confirmedAdult: true })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("an 18-year-old signing up for themselves", () => {
  const input = { ...birthFor(18), username: "calm_falcon_301", email: "josh@example.test", password: TEST_PASSWORD, consents: { ...REQUIRED_TICKED, tutor_history_retention: true } };

  it("creates a learner with their own email and a single-seat family that they own", async () => {
    const result = await signUpAdultLearner(anon(), input);
    expect(result.created).toBe(true);
    expectNoPlaceholderEmail(result);

    const learner = (await db.select().from(user).where(eq(user.id, result.userId ?? "")))[0];
    expect(learner).toMatchObject({ kind: "learner", username: "calm_falcon_301", email: "josh@example.test", emailVerified: false, status: "active" });
    const profile = (await db.select().from(learnerProfile))[0];
    expect(profile).toMatchObject({ userId: learner?.id, safetyBand: "adult_18", pathway: "sixth_form", birthMonth: 5 });
    expect(await db.select().from(family)).toMatchObject([{ id: result.familyId, ownerUserId: learner?.id, plan: "free" }]);
    expect(await db.select().from(familyMember)).toMatchObject([{ userId: learner?.id, role: "learner", familyId: result.familyId }]);

    // Their own consent, in their own name, at sign-up.
    const records = await db.select().from(consentRecord);
    expect(records.map((r) => r.consentKey).sort()).toEqual(["account_learning_data", "ai_processing", "third_party_tools", "tutor_history_retention"]);
    for (const record of records) expect(record).toMatchObject({ action: "granted", actorUserId: learner?.id, method: "signup", learnerId: learner?.id, consentVersion: 1 });

    // They must confirm the address before they can sign in.
    expect(authEmails).toMatchObject([{ kind: "verify_email", to: "josh@example.test" }]);
  });

  it("needs every required consent, and creates nothing without them", async () => {
    const attempt = signUpAdultLearner(anon(), { ...input, consents: { account_learning_data: true, ai_processing: true } });
    await expect(attempt).rejects.toMatchObject({ code: "consent_required", fieldErrors: { "consent.third_party_tools": expect.any(Array) } });
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("is refused for a 17-year-old, who needs a parent", async () => {
    await expect(signUpAdultLearner(anon(), { ...input, ...birthFor(17) })).rejects.toMatchObject({ code: "parent_approval_required" });
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("is refused when the owner has switched adult self-serve off, and the route chooser sends them the teen way", async () => {
    await setSetting(systemCtx("seed"), "site.adult_self_serve", false);
    await expect(signUpAdultLearner(anon(), input)).rejects.toMatchObject({ code: "parent_approval_required" });
    expect(await signupRouteForBirth(anon(), birthFor(18))).toBe("teen");
    await setSetting(systemCtx("seed"), "site.adult_self_serve", true);
    expect(await signupRouteForBirth(anon(), birthFor(18))).toBe("adult");
    expect(await signupRouteForBirth(anon(), birthFor(17))).toBe("teen");
  });

  it("does not reveal that an email address is already registered", async () => {
    await createParent({ email: "josh@example.test" });
    const result = await signUpAdultLearner(anon(), input);
    expect(result).toEqual({ created: false, userId: null, familyId: null });
    expect(await db.select().from(learnerProfile)).toHaveLength(0);
    expect(await db.select().from(family)).toHaveLength(1);
  });
});

describe("usernames against the database", () => {
  it("is unique whatever the capitals", async () => {
    await createLearner({ username: "pixel_wren_77" });
    const error = await assertUsernameAllowed(db, "Pixel_Wren_77").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid_input", fieldErrors: { username: [expect.stringMatching(/already taken/)] } });
  });

  it("offers three free, safe suggestions when a name is refused", async () => {
    await createLearner({ username: "pixel_wren_77" });
    const error = (await assertUsernameAllowed(db, "maya_2011", { nickname: "Maya", birthYear: 2011 }).catch((e: unknown) => e)) as { detail?: { suggestions?: string[] }; message: string };
    const suggestions = error.detail?.suggestions ?? [];
    expect(suggestions).toHaveLength(3);
    for (const suggestion of suggestions) {
      expect(error.message).toContain(suggestion);
      await expect(assertUsernameAllowed(db, suggestion, { nickname: "Maya", birthYear: 2011 })).resolves.toBe(suggestion);
    }
  });

  it("never suggests a name that is taken", async () => {
    const first = await suggestAvailableUsernames(db);
    expect(first).toHaveLength(3);
    for (const username of first) await createLearner({ username });
    const taken = new Set(first);
    for (let i = 0; i < 5; i++) for (const suggestion of await suggestAvailableUsernames(db)) expect(taken.has(suggestion)).toBe(false);
  });

  it("returns the tidy lower-case form of a good name", async () => {
    await expect(assertUsernameAllowed(db, "  Cosmic_Otter_5 ")).resolves.toBe("cosmic_otter_5");
  });
});
