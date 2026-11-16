import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { resetAuthEmailSender, setAuthEmailSender, type AuthEmail } from "@/server/auth/email";
import { LOCKOUT_MAX_FAILURES } from "@/server/auth/lockout";
import { learnerProfile, parentLinkRequest, session, user } from "@/server/db/schema";
import { getSentEmails } from "@/server/email";
import { addChild } from "@/server/services/children";
import { CONSENT_HOLD } from "@/server/services/consent";
import { LOCKOUT_MESSAGE } from "@/server/services/sign-in";
import { signUpTeen } from "@/server/services/teen-signup";
import { closeDb, db, testCtx } from "../../helpers/db";
import { TEST_PASSWORD, createLearner, createParent, createStaff } from "../../helpers/factories";
import { CHILD_TABLES, counterTotal, freshAccountsDb, mockedEntitlement, snapshot, userRow } from "./helpers";

/**
 * The Server Actions, called as functions. Next.js itself is not running, so the three things an
 * action takes from it are replaced: the request's cookies and headers (a small in-memory jar),
 * `redirect()` (throws the same kind of marker Next.js throws) and `revalidatePath` (a no-op).
 * Everything behind the action is real: Better Auth, the services and Postgres.
 *
 * MOCKED CONTRACT: `getEntitlementForFamily` (payments slice), as in the other files here.
 */
const web = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  /** A session cookie header from a real Better Auth sign-in, when the test acts as someone signed in. */
  sessionCookie: "",
  ip: "198.51.100.20",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (web.jar.has(name) ? { name, value: web.jar.get(name)?.value ?? "" } : undefined),
    has: (name: string) => web.jar.has(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => void web.jar.set(name, { value, options }),
    delete: (name: string) => void web.jar.delete(name),
  }),
  headers: async () => new Headers({ ...(web.sessionCookie ? { cookie: web.sessionCookie } : {}), "x-forwarded-for": web.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));

const signup = await import("@/app/(auth)/signup/actions");
const signin = await import("@/app/(auth)/signin/actions");
const join = await import("@/app/(auth)/join/actions");
const approve = await import("@/app/(auth)/approve/[token]/actions");
const children = await import("@/app/(parent)/parent/children/actions");
const onboarding = await import("@/app/(learner)/onboarding/actions");

let authEmails: AuthEmail[] = [];
let caller = 0;

beforeEach(async () => {
  await freshAccountsDb();
  web.jar.clear();
  web.sessionCookie = "";
  web.ip = `198.51.100.${(caller++ % 200) + 20}`;
  authEmails = [];
  setAuthEmailSender(async (email) => {
    authEmails.push(email);
  });
});
afterEach(() => resetAuthEmailSender());
afterAll(async () => {
  await closeDb();
});

const year = new Date().getFullYear();
/** A birth year that is safely this many years ago whatever the month (born in January, and the test adds one for the younger reading). */
const bornYearsAgo = (age: number) => ({ birthMonth: "1", birthYear: String(year - age - (new Date().getMonth() === 0 ? 1 : 0)) });

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  return data;
}

/** Runs an action and reports where it redirected to, or what it returned. */
async function run<T>(action: (prev: null, data: FormData) => Promise<T>, fields: Record<string, string | string[]>): Promise<{ redirect: string | null; result: T | null }> {
  try {
    return { redirect: null, result: await action(null, form(fields)) };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return { redirect: digest.split(";")[2] ?? "", result: null };
    throw error;
  }
}
/** The current six-digit code for a base32 authenticator key (RFC 6238, SHA-1, 30 seconds). */
function totpNow(base32Secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

type Failed = { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };
const failure = (outcome: { result: unknown }) => outcome.result as Failed;

/** Signs in for real and makes the following actions run as that person. */
async function actAs(kind: "username" | "email", identifier: string, password = TEST_PASSWORD): Promise<void> {
  const api = getAuth().api;
  const result = kind === "username" ? await api.signInUsername({ body: { username: identifier, password }, returnHeaders: true }) : await api.signInEmail({ body: { email: identifier, password }, returnHeaders: true });
  web.sessionCookie = (result.headers?.getSetCookie() ?? []).map((line) => line.split(";")[0]).join("; ");
}

describe("the under-13 block in the sign-up actions", () => {
  it("teen sign-up, step one: counts anonymously, sets a bare flag cookie, goes to /blocked-age and writes nothing else", async () => {
    const before = await snapshot(CHILD_TABLES);
    const outcome = await run(signup.teenAgeAction, bornYearsAgo(11));
    expect(outcome.redirect).toBe("/blocked-age");
    expect(await snapshot(CHILD_TABLES)).toEqual(before);
    expect(await counterTotal("signup.under13_blocked")).toBe(1);

    const cookie = web.jar.get("age_gate");
    expect(cookie?.value).toBe("1");
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(Number(cookie?.options?.maxAge)).toBeLessThanOrEqual(60 * 60);
    expect([...web.jar.keys()]).toEqual(["age_gate"]);
  });

  it("while the flag lasts, every sign-up action sends the visitor straight back without counting or writing", async () => {
    await run(signup.teenAgeAction, bornYearsAgo(11));
    const before = await snapshot(CHILD_TABLES);
    const good = { ...bornYearsAgo(15), username: "pixel_wren_77", password: TEST_PASSWORD, parentEmail: "mum@example.test" };
    expect((await run(signup.teenAgeAction, bornYearsAgo(15))).redirect).toBe("/blocked-age");
    expect((await run(signup.teenDetailsAction, good)).redirect).toBe("/blocked-age");
    expect((await run(signup.adultDetailsAction, { ...bornYearsAgo(19), username: "pixel_wren_77", email: "a@example.test", password: TEST_PASSWORD })).redirect).toBe("/blocked-age");
    expect((await run(signup.signUpParentAction, { email: "mum@example.test", password: TEST_PASSWORD, confirmedAdult: "on" })).redirect).toBe("/blocked-age");
    expect(await snapshot(CHILD_TABLES)).toEqual(before);
    expect(await counterTotal("signup.under13_blocked")).toBe(1);
  });

  it("step two re-checks the birth date that travels with the form: changing it to under 13 is blocked and stores nothing", async () => {
    const before = await snapshot(CHILD_TABLES);
    const outcome = await run(signup.teenDetailsAction, { ...bornYearsAgo(12), username: "pixel_wren_77", password: TEST_PASSWORD, parentEmail: "mum@example.test" });
    expect(outcome.redirect).toBe("/blocked-age");
    expect(await snapshot(CHILD_TABLES)).toEqual(before);
    expect(await counterTotal("signup.under13_blocked")).toBe(1);
    expect(getSentEmails()).toHaveLength(0);
  });

  it("a missing month or year is a form error, not a block", async () => {
    const outcome = await run(signup.teenAgeAction, { birthMonth: "", birthYear: "" });
    expect(failure(outcome)).toMatchObject({ ok: false, error: { code: "invalid_input", fieldErrors: { birth: expect.any(Array) } } });
    expect(web.jar.has("age_gate")).toBe(false);
    expect(await counterTotal("signup.under13_blocked")).toBe(0);
  });

  it("parent-add: an under-13 child is blocked before anything is written, and the parent is sent to /blocked-age", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    await actAs("email", "priya@example.test");
    const before = await snapshot(CHILD_TABLES);
    const outcome = await run(children.addChildAction, { ...bornYearsAgo(10), nickname: "Bea", username: "bea_bakes_cakes", password: TEST_PASSWORD });
    expect(outcome.redirect).toBe("/blocked-age");
    expect(await snapshot(CHILD_TABLES)).toEqual(before);
    expect(await counterTotal("signup.under13_blocked")).toBe(1);
    expect(web.jar.get("age_gate")?.value).toBe("1");
    // And with the flag set, an immediate retry with another date does not get through.
    expect((await run(children.addChildAction, { ...bornYearsAgo(14), nickname: "Bea", username: "bea_bakes_cakes", password: TEST_PASSWORD })).redirect).toBe("/blocked-age");
    expect(await db.select().from(learnerProfile)).toHaveLength(0);
  });
});

describe("sign-up actions", () => {
  it("teen step one sends a 15-year-old to the teen form with three username ideas, and an 18-year-old to the adult form", async () => {
    const teen = await run(signup.teenAgeAction, bornYearsAgo(15));
    expect(teen.result).toMatchObject({ ok: true, data: { route: "teen", birthMonth: 1 } });
    expect((teen.result as { data: { suggestions: string[] } }).data.suggestions).toHaveLength(3);
    expect((await run(signup.teenAgeAction, bornYearsAgo(19))).result).toMatchObject({ ok: true, data: { route: "adult" } });
  });

  it("teen step two creates the pending account, emails the parent, signs the teen in and goes to the waiting page", async () => {
    const outcome = await run(signup.teenDetailsAction, { ...bornYearsAgo(15), username: "Pixel_Wren_77", password: TEST_PASSWORD, parentEmail: "Mum@Example.test" });
    expect(outcome.redirect).toBe("/signup/teen/waiting");
    const teen = (await db.select().from(user).where(eq(user.username, "pixel_wren_77")))[0];
    expect(teen).toMatchObject({ status: "pending_parent", kind: "learner" });
    expect((await db.select().from(parentLinkRequest))[0]).toMatchObject({ parentEmail: "mum@example.test", learnerId: teen?.id });
    expect(getSentEmails()).toMatchObject([{ template: "parent_approval_request", to: "mum@example.test" }]);
    expect(await db.select().from(session).where(eq(session.userId, teen?.id ?? ""))).toHaveLength(1);
  });

  it("shows field errors for a bad username, password or parent email, and creates nothing", async () => {
    const base = { ...bornYearsAgo(15), username: "pixel_wren_77", password: TEST_PASSWORD, parentEmail: "mum@example.test" };
    expect(failure(await run(signup.teenDetailsAction, { ...base, parentEmail: "not-an-email" })).error.fieldErrors?.parentEmail?.[0]).toMatch(/email address/);
    expect(failure(await run(signup.teenDetailsAction, { ...base, username: "leeds_lad" })).error.fieldErrors?.username?.[0]).toMatch(/school, year group or place/);
    expect(failure(await run(signup.teenDetailsAction, { ...base, password: "short" })).error.fieldErrors?.password?.[0]).toBeTruthy();
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("parent sign-up answers the same for a new and an existing address", async () => {
    const fields = { email: "priya@example.test", password: TEST_PASSWORD, confirmedAdult: "on" };
    const first = await run(signup.signUpParentAction, fields);
    const second = await run(signup.signUpParentAction, fields);
    expect(first.result).toEqual({ ok: true, data: { sent: true } });
    expect(second.result).toEqual(first.result);
    expect(await db.select().from(user)).toHaveLength(1);
    expect(failure(await run(signup.signUpParentAction, { email: "x@example.test", password: TEST_PASSWORD })).error.fieldErrors?.confirmedAdult).toBeTruthy();
  });

  it("the adult form needs the three required consents ticked", async () => {
    const base = { ...bornYearsAgo(19), username: "calm_falcon_301", email: "josh@example.test", password: TEST_PASSWORD, consentKeys: "account_learning_data,ai_processing,third_party_tools,tutor_history_retention,product_improvement_analytics" };
    const missing = failure(await run(signup.adultDetailsAction, { ...base, "consent.account_learning_data": "on" }));
    expect(missing.error.code).toBe("consent_required");
    const done = await run(signup.adultDetailsAction, { ...base, "consent.account_learning_data": "on", "consent.ai_processing": "on", "consent.third_party_tools": "on" });
    expect(done.result).toEqual({ ok: true, data: { sent: true } });
    expect(authEmails).toMatchObject([{ kind: "verify_email", to: "josh@example.test" }]);
    // A 17-year-old cannot use the adult form by posting to it directly.
    expect(failure(await run(signup.adultDetailsAction, { ...base, ...bornYearsAgo(17), username: "calm_falcon_302", email: "j2@example.test" })).error.code).toBe("parent_approval_required");
  });
});

describe("sign-in actions", () => {
  it("signs a learner in, copies saved accessibility preferences into the a11y cookie and routes by onboarding", async () => {
    const { user: learner } = await createLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    await db.update(learnerProfile).set({ a11y: { theme: "dark", reading: "dyslexia", text: "125", motion: "reduce" } }).where(eq(learnerProfile.userId, learner.id));

    const first = await run(signin.signInLearnerAction, { username: "PIXEL_wren_77", password: TEST_PASSWORD, next: "/explore" });
    expect(first.redirect).toBe("/onboarding"); // not onboarded yet: that comes before `next`
    const cookie = web.jar.get("a11y");
    expect(JSON.parse(cookie?.value ?? "{}")).toEqual({ theme: "dark", reading: "dyslexia", text: "125", motion: "reduce" });
    expect(cookie?.options).toMatchObject({ path: "/", sameSite: "lax", httpOnly: false });
    expect(await db.select().from(session).where(eq(session.userId, learner.id))).toHaveLength(1);

    await db.update(learnerProfile).set({ onboardingCompletedAt: new Date() }).where(eq(learnerProfile.userId, learner.id));
    expect((await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: TEST_PASSWORD })).redirect).toBe("/home");
    expect((await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: TEST_PASSWORD, next: "/portfolio" })).redirect).toBe("/portfolio");
    // A link cannot send a learner to a parent page or to another website.
    expect((await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: TEST_PASSWORD, next: "/parent/billing" })).redirect).toBe("/home");
    expect((await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: TEST_PASSWORD, next: "https://evil.example/" })).redirect).toBe("/home");
  });

  it("writes no a11y cookie for a learner who has never chosen any preferences", async () => {
    await createLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: TEST_PASSWORD });
    expect(web.jar.has("a11y")).toBe(false);
  });

  it("answers a wrong password calmly, and the short lock more calmly still", async () => {
    await createLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    const wrong = failure(await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: "not-the-password" }));
    expect(wrong.error).toMatchObject({ code: "unauthenticated", message: "That username and password don't match. Check both, then try again." });
    for (let i = 1; i < LOCKOUT_MAX_FAILURES; i++) await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: "not-the-password" });
    const locked = failure(await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: TEST_PASSWORD }));
    expect(locked.error).toMatchObject({ code: "rate_limited", message: LOCKOUT_MESSAGE.username });
    expect(await db.select().from(session)).toHaveLength(0);
  });

  it("limits how often one caller can try, across usernames", async () => {
    const codes: string[] = [];
    for (let i = 0; i < 22; i++) codes.push(failure(await run(signin.signInLearnerAction, { username: `nobody_here_${i}`, password: "not-the-password" })).error.code);
    expect(codes.slice(0, 20).every((code) => code === "unauthenticated")).toBe(true);
    expect(codes.slice(20)).toEqual(["rate_limited", "rate_limited"]);
  });

  it("routes a parent to onboarding, to the dashboard once they have a child, and back to an approval link", async () => {
    const { family } = await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    expect((await run(signin.signInEmailAction, { email: " Priya@Example.test ", password: TEST_PASSWORD })).redirect).toBe("/parent/onboarding");
    expect((await run(signin.signInEmailAction, { email: "priya@example.test", password: TEST_PASSWORD, next: "/approve/some-token" })).redirect).toBe("/approve/some-token");
    await createLearner({ familyId: family.id });
    expect((await run(signin.signInEmailAction, { email: "priya@example.test", password: TEST_PASSWORD })).redirect).toBe("/parent");
    expect((await run(signin.signInEmailAction, { email: "priya@example.test", password: TEST_PASSWORD, next: "/home" })).redirect).toBe("/parent");
  });

  it("asks a parent who has not confirmed their address to use the fresh link it has just sent", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD, emailVerified: false });
    const outcome = failure(await run(signin.signInEmailAction, { email: "priya@example.test", password: TEST_PASSWORD, next: "/parent/notices" }));
    expect(outcome.error.message).toMatch(/hasn't been confirmed yet/);
    expect(authEmails).toHaveLength(1);
    expect(authEmails[0]?.kind).toBe("verify_email");
    // After confirming, they land on the page they were trying to reach.
    expect(new URL(authEmails[0]?.url ?? "").searchParams.get("callbackURL")).toBe("/signin/continue?next=%2Fparent%2Fnotices");
  });

  it("sends staff with two-step switched on to the code page, with no session yet", async () => {
    const staff = await createStaff({ email: "sam@example.test", password: TEST_PASSWORD });
    await actAs("email", "sam@example.test");
    const start = await run(signin.startTwoFactorSetupAction, { password: TEST_PASSWORD });
    const enrolment = (start.result as { ok: true; data: { secret: string; totpUri: string; backupCodes: string[] } }).data;
    expect(enrolment.secret.length).toBeGreaterThanOrEqual(16);
    expect(enrolment.totpUri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrolment.backupCodes.length).toBeGreaterThanOrEqual(8);
    expect(failure(await run(signin.confirmTwoFactorSetupAction, { code: "000000" })).error).toMatchObject({ code: "invalid_input", fieldErrors: { code: expect.any(Array) } });
    expect(failure(await run(signin.startTwoFactorSetupAction, { password: "not-the-password" })).error.code).toBe("invalid_input");

    // Enrolment finished elsewhere: from then on the password alone gives no session.
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, staff.user.id));
    web.sessionCookie = "";
    await db.delete(session);
    const outcome = await run(signin.signInEmailAction, { email: "sam@example.test", password: TEST_PASSWORD, next: "/studio/review" });
    expect(outcome.redirect).toBe("/signin/two-factor?next=%2Fstudio%2Freview");
    expect(await db.select().from(session)).toHaveLength(0);
    expect(failure(await run(signin.verifyTwoFactorAction, { code: "123456" })).error.code).toMatch(/unauthenticated|invalid_input/);
  });

  /**
   * How many times the action looked the session up after `call` had run. Better Auth is not
   * running inside Next.js here, so the cookies it sets never reach the jar above; what can be
   * checked is the cause of the bug rather than the cookie itself.
   */
  const lookUpsAfter = (lookUp: { mock: { invocationCallOrder: number[] } }, call: { mock: { invocationCallOrder: number[] } }): number => {
    const last = Math.max(...call.mock.invocationCallOrder);
    return lookUp.mock.invocationCallOrder.filter((order) => order > last).length;
  };

  // Regression: the request still carries the cookie the browser sent. If the action looks the
  // session up again after signing in, Better Auth finds that old cookie dead and clears the
  // session cookie, which wipes out the one it has just set: the person lands on their first page
  // signed out. Seen in a browser for a learner whose sessions a parent had ended, and for every
  // member of staff finishing first-time two-step set-up.
  it("does not look the session up again once a sign-in has replaced the cookie the browser sent", async () => {
    const { user: learner } = await createLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    await actAs("username", "pixel_wren_77");
    await db.delete(session); // signed out everywhere, as after a parent resets the password
    const api = getAuth().api;
    const getSession = vi.spyOn(api, "getSession");
    const signInUsername = vi.spyOn(api, "signInUsername");
    try {
      const outcome = await run(signin.signInLearnerAction, { username: "pixel_wren_77", password: TEST_PASSWORD });
      expect(outcome.redirect).toBe("/onboarding");
      expect(signInUsername).toHaveBeenCalledTimes(1);
      expect(lookUpsAfter(getSession, signInUsername)).toBe(0);
      expect(await db.select().from(session).where(eq(session.userId, learner.id))).toHaveLength(1);
    } finally {
      getSession.mockRestore();
      signInUsername.mockRestore();
    }
  });

  it("first-time two-step set-up ends with one verified session, and does not look the replaced one up", async () => {
    const staff = await createStaff({ email: "sam@example.test", password: TEST_PASSWORD });
    await actAs("email", "sam@example.test");
    const start = await run(signin.startTwoFactorSetupAction, { password: TEST_PASSWORD });
    const { secret } = (start.result as { ok: true; data: { secret: string } }).data;
    const api = getAuth().api;
    const getSession = vi.spyOn(api, "getSession");
    const verifyTOTP = vi.spyOn(api, "verifyTOTP");
    try {
      const outcome = await run(signin.confirmTwoFactorSetupAction, { code: totpNow(secret), next: "/studio/review" });
      expect(outcome.redirect).toBe("/studio/review");
      expect(verifyTOTP).toHaveBeenCalledTimes(1);
      expect(lookUpsAfter(getSession, verifyTOTP)).toBe(0);
    } finally {
      getSession.mockRestore();
      verifyTOTP.mockRestore();
    }
    // The password-only session was replaced by a verified one, not kept alongside it.
    const rows = await db.select({ twoFactorVerified: session.twoFactorVerified }).from(session).where(eq(session.userId, staff.user.id));
    expect(rows).toEqual([{ twoFactorVerified: true }]);
    expect((await db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.id, staff.user.id)))[0]?.on).toBe(true);
  });

  it("joining with a code on a device where someone else is signed in does not look their ended session up", async () => {
    const { user: parent, family } = await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    const added = await addChild(testCtx({ type: "parent", userId: parent.id, familyId: family.id, status: "active" }), { nickname: "Maya", username: "brave_otter_314", birthMonth: 1, birthYear: Number(bornYearsAgo(14).birthYear) });
    await actAs("email", "priya@example.test"); // the parent is still signed in on the family laptop
    const api = getAuth().api;
    const getSession = vi.spyOn(api, "getSession");
    const signInUsername = vi.spyOn(api, "signInUsername");
    try {
      const outcome = await run(join.redeemInviteAction, { code: added.invite?.formatted ?? "", username: "brave_otter_314", password: "plum-tractor-violin-42" });
      expect(outcome.redirect).toBe("/home"); // held for consent, so home explains the pause
      expect(signInUsername).toHaveBeenCalledTimes(1);
      expect(lookUpsAfter(getSession, signInUsername)).toBe(0);
    } finally {
      getSession.mockRestore();
      signInUsername.mockRestore();
    }
  });

  it("the magic-link and reset forms give the same answer whether or not the address has an account", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    const known = await run(signin.sendMagicLinkAction, { email: "priya@example.test" });
    const unknown = await run(signin.sendMagicLinkAction, { email: "stranger@example.test" });
    expect(known.result).toEqual({ ok: true, data: { sent: true } });
    expect(unknown.result).toEqual(known.result);
    expect(authEmails.map((e) => e.kind)).toEqual(["magic_link"]);

    const resetKnown = await run(signin.requestPasswordResetAction, { email: "priya@example.test" });
    const resetUnknown = await run(signin.requestPasswordResetAction, { email: "stranger@example.test" });
    expect(resetUnknown.result).toEqual(resetKnown.result);
    expect(authEmails.map((e) => e.kind)).toEqual(["magic_link", "reset_password"]);
  });

  it("never emails a reset link or a sign-in link for a learner under 18", async () => {
    const { user: teen } = await createLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    await run(signin.requestPasswordResetAction, { email: teen.email });
    await run(signin.sendMagicLinkAction, { email: teen.email });
    expect(authEmails).toEqual([]);
  });

  it("resets a parent's password from the emailed link, with the password rules explained", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    await run(signin.requestPasswordResetAction, { email: "priya@example.test" });
    const token = new URL(authEmails[0]?.url ?? "").pathname.split("/").pop() ?? "";
    expect(failure(await run(signin.resetPasswordAction, { token, password: "qwertyuiop" })).error.fieldErrors?.password?.[0]).toBeTruthy();
    expect((await run(signin.resetPasswordAction, { token, password: "meadow-kettle-comet-77" })).result).toEqual({ ok: true, data: { done: true } });
    expect((await run(signin.signInEmailAction, { email: "priya@example.test", password: "meadow-kettle-comet-77" })).redirect).toBe("/parent/onboarding");
    expect(failure(await run(signin.resetPasswordAction, { token, password: "another-good-pass-91" })).error.message).toMatch(/run out or has already been used/);
  });

  it("signing out ends the session and goes to the sign-in page", async () => {
    const { user: learner } = await createLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    await actAs("username", "pixel_wren_77");
    expect(await db.select().from(session).where(eq(session.userId, learner.id))).toHaveLength(1);
    await expect(signin.signOutAction()).rejects.toMatchObject({ digest: expect.stringContaining("/signin") });
    expect(await db.select().from(session).where(eq(session.userId, learner.id))).toHaveLength(0);
  });
});

describe("joining with an invite code", () => {
  it("sets the learner's own password, signs them in and sends them on", async () => {
    const { actor } = await createParent();
    const added = await addChild(testCtx(actor), { birthYear: year - 15, birthMonth: 1, nickname: "Maya", username: "pixel_wren_77", password: null });
    const outcome = await run(join.redeemInviteAction, { code: added.invite?.formatted.toLowerCase() ?? "", username: "Pixel_Wren_77", password: "meadow-kettle-comet-77" });
    // Still held for consent, so home (where that is explained), not onboarding.
    expect(outcome.redirect).toBe("/home");
    expect(await userRow(added.learnerId)).toMatchObject({ status: "paused", statusReason: CONSENT_HOLD.required });
    expect(await db.select().from(session).where(eq(session.userId, added.learnerId))).toHaveLength(1);

    const again = failure(await run(join.redeemInviteAction, { code: added.invite?.code ?? "", username: "pixel_wren_77", password: "another-good-pass-91" }));
    expect(again.error.message).toMatch(/already been used/);
  });

  it("says the same for a wrong code and an unknown username", async () => {
    const { actor } = await createParent();
    await addChild(testCtx(actor), { birthYear: year - 15, birthMonth: 1, nickname: "Maya", username: "pixel_wren_77", password: null });
    const wrongCode = failure(await run(join.redeemInviteAction, { code: "ABCD-EFGH", username: "pixel_wren_77", password: "meadow-kettle-comet-77" }));
    const noUser = failure(await run(join.redeemInviteAction, { code: "ABCD-EFGH", username: "nobody_here_1", password: "meadow-kettle-comet-77" }));
    expect(wrongCode.error.message).toBe(noUser.error.message);
  });
});

describe("parent actions", () => {
  it("adding a child with a password goes straight to the consent centre; without one, the code is returned once", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    await actAs("email", "priya@example.test");
    const withPassword = await run(children.addChildAction, { ...bornYearsAgo(15), nickname: "Maya", username: "pixel_wren_77", password: "meadow-kettle-comet-77" });
    const maya = (await db.select().from(user).where(eq(user.username, "pixel_wren_77")))[0];
    expect(withPassword.redirect).toBe(`/parent/children/${maya?.id}/consent?from=new`);

    const withCode = await run(children.addChildAction, { ...bornYearsAgo(17), nickname: "Josh", username: "calm_falcon_30" });
    expect(withCode.result).toMatchObject({ ok: true, data: { nickname: "Josh", username: "calm_falcon_30", invite: { code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/), expiresOn: expect.any(String) } } });
    expect(JSON.stringify(withCode.result)).not.toMatch(/learner\.invalid/);

    // The plan has two places.
    const third = failure(await run(children.addChildAction, { ...bornYearsAgo(14), nickname: "Sam", username: "sunny_heron_41" }));
    expect(third.error).toMatchObject({ code: "entitlement_required", message: expect.stringMatching(/room for 2 learners/) });
  });

  it("is refused for a learner and for a signed-out visitor", async () => {
    expect(failure(await run(children.addChildAction, { ...bornYearsAgo(15), nickname: "Maya", username: "pixel_wren_77" })).error.code).toBe("unauthenticated");
    await createLearner({ username: "calm_falcon_30", password: TEST_PASSWORD, age: 17 });
    await actAs("username", "calm_falcon_30");
    expect(failure(await run(children.addChildAction, { ...bornYearsAgo(15), nickname: "Maya", username: "pixel_wren_77" })).error.code).toBe("forbidden");
    expect(await db.select().from(user).where(eq(user.username, "pixel_wren_77"))).toHaveLength(0);
  });

  it("saving the consent centre activates the child; unticking a needed permission later needs the confirmation", async () => {
    const { actor } = await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    const added = await addChild(testCtx(actor), { birthYear: year - 15, birthMonth: 1, nickname: "Maya", username: "pixel_wren_77", password: TEST_PASSWORD });
    await actAs("email", "priya@example.test");
    const keys = "account_learning_data,ai_processing,third_party_tools,tutor_history_retention,product_improvement_analytics";
    const all = { learnerId: added.learnerId, consentKeys: keys, "consent.account_learning_data": "on", "consent.ai_processing": "on", "consent.third_party_tools": "on" };

    const partial = await run(children.saveConsentsAction, { learnerId: added.learnerId, consentKeys: keys, "consent.ai_processing": "on" });
    expect(partial.result).toMatchObject({ ok: true, data: { status: "paused", activated: false, missingRequired: ["account_learning_data", "third_party_tools"] } });
    const done = await run(children.saveConsentsAction, all);
    expect(done.result).toMatchObject({ ok: true, data: { status: "active", activated: true, missingRequired: [] } });

    const { "consent.ai_processing": _removed, ...withoutCoach } = all;
    const refused = failure(await run(children.saveConsentsAction, withoutCoach));
    expect(refused.error.fieldErrors?.confirmPause).toBeTruthy();
    expect(await userRow(added.learnerId)).toMatchObject({ status: "active" });
    const paused = await run(children.saveConsentsAction, { ...withoutCoach, confirmPause: "on" });
    expect(paused.result).toMatchObject({ ok: true, data: { status: "paused", paused: true } });
  });

  it("another family's parent cannot save consents for the child", async () => {
    const { actor } = await createParent();
    const added = await addChild(testCtx(actor), { birthYear: year - 15, birthMonth: 1, nickname: "Maya", username: "pixel_wren_77", password: TEST_PASSWORD });
    await createParent({ email: "stranger@example.test", password: TEST_PASSWORD });
    await actAs("email", "stranger@example.test");
    const outcome = failure(await run(children.saveConsentsAction, { learnerId: added.learnerId, consentKeys: "ai_processing", "consent.ai_processing": "on" }));
    expect(outcome.error.code).toBe("forbidden");
    expect(failure(await run(children.saveConsentsAction, { learnerId: "not-a-uuid", consentKeys: "" })).error.code).toBe("invalid_input");
  });
});

describe("parent pages", () => {
  /** Where a page helper redirected to, or null when it let the visitor in. */
  async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
    try {
      await fn();
      return null;
    } catch (error) {
      const digest = (error as { digest?: string }).digest ?? "";
      if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
      throw error;
    }
  }

  // Regression: the pages used `requireParent()`, which throws `forbidden`. Next.js renders a page
  // alongside its layout, so for a learner that error raced the layout's redirect and was logged
  // as a server error on every visit.
  it("send anyone who is not a parent away by redirect, never by throwing an error", async () => {
    const { requireParentPage } = await import("@/app/(auth)/_lib/after-sign-in");
    expect(await redirectOf(requireParentPage)).toBe("/signin?as=parent");

    await createLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    await actAs("username", "pixel_wren_77");
    expect(await redirectOf(requireParentPage)).toBe("/onboarding");

    await createStaff({ email: "sam@example.test", password: TEST_PASSWORD });
    await actAs("email", "sam@example.test");
    expect(await redirectOf(requireParentPage)).toMatch(/^\/(studio|signin\/two-factor\/setup)$/);

    const { user: parent, family } = await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    await actAs("email", "priya@example.test");
    const ctx = await requireParentPage();
    expect(ctx.actor).toMatchObject({ type: "parent", userId: parent.id, familyId: family.id });
  });
});

describe("approval actions", () => {
  async function pendingTeen() {
    await signUpTeen(testCtx(), { birthYear: year - 15, birthMonth: 1, username: "pixel_wren_77", password: TEST_PASSWORD, parentEmail: "priya@example.test" });
    const text = getSentEmails().at(-1)?.text ?? "";
    return /\/approve\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";
  }

  it("a new parent creates their account from the link, then approves, and is sent to the consent centre", async () => {
    const token = await pendingTeen();
    const created = await run(approve.createParentForApprovalAction, { token, password: "meadow-kettle-comet-77", confirmedAdult: "on" });
    expect(created.redirect).toBe(`/approve/${token}`);
    expect((await db.select().from(user).where(eq(user.kind, "parent")))[0]).toMatchObject({ email: "priya@example.test", emailVerified: true });

    // Not signed in: approving is refused.
    expect(failure(await run(approve.approveTeenAction, { token })).error.code).toBe("unauthenticated");
    await actAs("email", "priya@example.test", "meadow-kettle-comet-77");
    const approved = await run(approve.approveTeenAction, { token });
    const teen = (await db.select().from(user).where(eq(user.username, "pixel_wren_77")))[0];
    expect(approved.redirect).toBe(`/parent/children/${teen?.id}/consent?from=approval`);
    expect(teen).toMatchObject({ status: "paused", statusReason: CONSENT_HOLD.required });
  });

  it("declining needs the confirmation tick, then deletes the account", async () => {
    const token = await pendingTeen();
    expect(failure(await run(approve.declineTeenAction, { token })).error.fieldErrors?.confirm).toBeTruthy();
    expect(await db.select().from(user)).toHaveLength(1);
    expect((await run(approve.declineTeenAction, { token, confirm: "on" })).redirect).toBe(`/approve/${token}?declined=1`);
    expect(await db.select().from(user)).toHaveLength(0);
  });
});

describe("learner onboarding actions", () => {
  it("walks interests, avatar and finish, and is refused for a parent", async () => {
    const { user: learner } = await createLearner({ username: "pixel_wren_77", password: TEST_PASSWORD, interests: [] });
    await actAs("username", "pixel_wren_77");
    expect(failure(await run(onboarding.saveInterestsAction, { interests: ["music", "games"] })).error.fieldErrors?.interests).toBeTruthy();
    expect((await run(onboarding.saveInterestsAction, { interests: ["music", "games", "coding"] })).redirect).toBe("/onboarding?step=avatar");
    expect((await run(onboarding.saveAvatarAction, { avatar: "Ab3_-xYz90Qw" })).redirect).toBe("/onboarding?step=accessibility");
    await onboarding.saveAccessibilityAction({ theme: "dark", reading: "default", text: "112", motion: "auto" });
    expect((await run(onboarding.finishOnboardingAction, { project: "build-your-own-app", later: "1" })).redirect).toBe("/home");
    expect((await run(onboarding.finishOnboardingAction, { project: "build-your-own-app" })).redirect).toBe("/explore/build-your-own-app");
    expect((await db.select().from(learnerProfile).where(eq(learnerProfile.userId, learner.id)))[0]).toMatchObject({ interests: ["music", "games", "coding"], avatarSeed: "Ab3_-xYz90Qw", a11y: { theme: "dark", text: "112" } });

    await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    await actAs("email", "priya@example.test");
    expect(failure(await run(onboarding.saveInterestsAction, { interests: ["music", "games", "coding"] })).error.code).toBe("forbidden");
    await expect(onboarding.saveAccessibilityAction({ theme: "dark", reading: "default", text: "112", motion: "auto" })).rejects.toMatchObject({ code: "forbidden" });
  });
});
