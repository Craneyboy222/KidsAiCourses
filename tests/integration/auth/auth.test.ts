import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, revokeAllSessions, setAccountPassword } from "@/server/auth/accounts";
import { STAFF_SESSION_SECONDS, createAuth, getAuth } from "@/server/auth/auth";
import { resetAuthEmailSender, setAuthEmailSender, type AuthEmail } from "@/server/auth/email";
import { userEmail } from "@/server/auth/learner-email";
import {
  LOCKOUT_MAX_FAILURES,
  clearFailedSignIns,
  recordFailedSignIn,
  setAccountLockedHandler,
  type AccountLockedEvent,
} from "@/server/auth/lockout";
import { assertStaffSecondFactor, resolveCtx, systemCtx } from "@/server/context";
import { account, authRateLimit, learnerProfile, session, twoFactor, user } from "@/server/db/schema";
import { closeDb, db, resetDb } from "../../helpers/db";
import {
  TEST_PASSWORD,
  createFamily,
  createLearner,
  createParent,
  createStaff,
} from "../../helpers/factories";

const auth = getAuth();

/** Turns the Set-Cookie headers of a response into a Cookie request header. */
function cookieHeader(headers: Headers | null | undefined, previous = ""): string {
  const jar = new Map<string, string>();
  for (const pair of previous.split("; ").filter(Boolean)) {
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  for (const line of headers?.getSetCookie() ?? []) {
    const pair = line.split(";")[0] ?? "";
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    // An expired cookie is a deletion.
    if (/max-age=0/i.test(line) || value === "") jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

const withCookie = (cookie: string) => new Headers({ cookie });

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 seconds), so the test can act as an authenticator app. */
function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0xf;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

async function signInLearner(username: string, password = TEST_PASSWORD) {
  const result = await auth.api.signInUsername({ body: { username, password }, returnHeaders: true });
  return { cookie: cookieHeader(result.headers), response: result.response };
}

async function signInByEmail(email: string, password = TEST_PASSWORD) {
  const result = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return { cookie: cookieHeader(result.headers), response: result.response, headers: result.headers };
}

/** The error a Better Auth API call rejects with: `{ status, body: { code, message } }`. */
async function apiError(
  run: () => Promise<unknown>,
): Promise<{ status: string; code?: string; message?: string }> {
  try {
    await run();
  } catch (error) {
    const e = error as { status?: string; body?: { code?: string; message?: string } };
    return { status: String(e.status), code: e.body?.code, message: e.body?.message };
  }
  throw new Error("Expected the call to be refused, but it succeeded");
}

let sentEmails: AuthEmail[] = [];

beforeEach(async () => {
  await resetDb();
  sentEmails = [];
  setAuthEmailSender(async (email) => {
    sentEmails.push(email);
  });
});

afterEach(() => {
  resetAuthEmailSender();
  setAccountLockedHandler(undefined);
});

afterAll(async () => {
  await closeDb();
});

describe("learner sign-in (username and password)", () => {
  it("signs a learner in and resolves a learner Actor from the session cookie", async () => {
    const { family } = await createFamily();
    const learner = await createLearner({
      age: 14,
      familyId: family.id,
      username: "maya_k",
      password: TEST_PASSWORD,
    });

    const { cookie, response } = await signInLearner("maya_k");
    expect(response.token).toBeTruthy();
    expect(response.user.id).toBe(learner.user.id);

    const ctx = await resolveCtx(withCookie(cookie));
    expect(ctx.actor).toEqual({
      type: "learner",
      userId: learner.user.id,
      familyId: family.id,
      safetyBand: "teen_13_15",
      age: 14,
      status: "active",
    });
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses UUIDs for users and sessions", async () => {
    await createLearner({ username: "josh17", password: TEST_PASSWORD });
    await signInLearner("josh17");
    const sessions = await db.select().from(session);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sessions[0]?.userId).toMatch(/^[0-9a-f]{8}-/);
  });

  it("accepts the username in any capitalisation", async () => {
    await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const { response } = await signInLearner("Maya_K");
    expect(response.token).toBeTruthy();
  });

  it("never returns the placeholder email, from sign-in or from the session", async () => {
    const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    expect(learner.user.email).toMatch(/@learner\.invalid$/);
    expect(userEmail(learner.user)).toBeNull();

    const { cookie, response } = await signInLearner("maya_k");
    expect(response.user.email).toBeNull();
    expect(JSON.stringify(response)).not.toContain("learner.invalid");

    const current = await auth.api.getSession({ headers: withCookie(cookie) });
    expect(current?.user.email).toBeNull();
    expect(JSON.stringify(current)).not.toContain("learner.invalid");
  });

  it("does not hide a parent's real email", async () => {
    const parent = await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    const { cookie, response } = await signInByEmail("priya@example.test");
    expect(response.user.email).toBe("priya@example.test");
    const current = await auth.api.getSession({ headers: withCookie(cookie) });
    expect(current?.user.email).toBe("priya@example.test");
    expect(userEmail(parent.user)).toBe("priya@example.test");
  });

  it("refuses the placeholder email as a way to sign in or reset a password", async () => {
    const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const signIn = await apiError(() => signInByEmail(learner.user.email));
    expect(signIn).toMatchObject({ status: "BAD_REQUEST", code: "INVALID_EMAIL" });

    const reset = await apiError(() =>
      auth.api.requestPasswordReset({ body: { email: learner.user.email, redirectTo: "/reset" } }),
    );
    expect(reset).toMatchObject({ status: "BAD_REQUEST", code: "INVALID_EMAIL" });
    expect(sentEmails).toEqual([]);
  });

  it("rejects a wrong password with the same answer as an unknown username", async () => {
    await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const wrong = await apiError(() => signInLearner("maya_k", "not-the-password-1"));
    const unknown = await apiError(() => signInLearner("nobody_here", "not-the-password-1"));
    expect(wrong.status).toBe("UNAUTHORIZED");
    expect(unknown).toEqual(wrong);
  });

  it("gives the learner a session that renews but can never run past 30 days", async () => {
    await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    await signInLearner("maya_k");
    const row = (await db.select().from(session))[0];
    const days = (date: Date | null | undefined) => ((date?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days(row?.expiresAt)).toBeGreaterThan(6.9);
    expect(days(row?.expiresAt)).toBeLessThan(7.1);
    expect(days(row?.absoluteExpiresAt)).toBeGreaterThan(29.9);
    expect(days(row?.absoluteExpiresAt)).toBeLessThan(30.1);
    expect(row?.twoFactorVerified).toBe(false);
  });
});

describe("who may hold a session", () => {
  it.each(["banned", "deleted", "locked"] as const)("refuses sign-in for a %s account", async (status) => {
    await createLearner({ username: "maya_k", password: TEST_PASSWORD, status });
    const refused = await apiError(() => signInLearner("maya_k"));
    expect(refused).toMatchObject({ status: "FORBIDDEN", code: "ACCOUNT_UNAVAILABLE" });
    expect(await db.select().from(session)).toHaveLength(0);
  });

  it.each(["banned", "deleted", "locked"] as const)(
    "treats an existing session as signed out once the account is %s",
    async (status) => {
      const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD });
      const { cookie } = await signInLearner("maya_k");
      expect((await resolveCtx(withCookie(cookie))).actor.type).toBe("learner");

      await db.update(user).set({ status }).where(eq(user.id, learner.user.id));
      expect((await resolveCtx(withCookie(cookie))).actor).toEqual({ type: "anonymous" });
    },
  );

  it("keeps a paused or pending learner signed in, with the status on the Actor for authz to act on", async () => {
    await createLearner({ username: "paused_one", password: TEST_PASSWORD, status: "paused" });
    await createLearner({ username: "pending_one", password: TEST_PASSWORD, status: "pending_parent" });
    const paused = await resolveCtx(withCookie((await signInLearner("paused_one")).cookie));
    const pending = await resolveCtx(withCookie((await signInLearner("pending_one")).cookie));
    expect(paused.actor).toMatchObject({ type: "learner", status: "paused" });
    expect(pending.actor).toMatchObject({ type: "learner", status: "pending_parent", familyId: null });
  });

  it("is anonymous with no cookie, a made-up cookie, or after sign-out", async () => {
    expect((await resolveCtx(new Headers())).actor).toEqual({ type: "anonymous" });
    expect((await resolveCtx(withCookie("better-auth.session_token=made-up.signature"))).actor).toEqual({
      type: "anonymous",
    });

    await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const { cookie } = await signInLearner("maya_k");
    await auth.api.signOut({ headers: withCookie(cookie) });
    expect((await resolveCtx(withCookie(cookie))).actor).toEqual({ type: "anonymous" });
  });

  it("ends every session at once when a learner is paused (revokeAllSessions)", async () => {
    const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const first = await signInLearner("maya_k");
    const second = await signInLearner("maya_k");
    expect(await revokeAllSessions(db, learner.user.id)).toBe(2);
    expect((await resolveCtx(withCookie(first.cookie))).actor.type).toBe("anonymous");
    expect((await resolveCtx(withCookie(second.cookie))).actor.type).toBe("anonymous");
  });

  it("treats a user of an unknown kind as signed out", async () => {
    // `user.kind` is open text for future account types. Until the code knows a kind, it gets nothing.
    const parent = await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    const { cookie } = await signInByEmail("priya@example.test");
    await db
      .update(user)
      .set({ kind: "teacher" as never })
      .where(eq(user.id, parent.user.id));
    expect((await resolveCtx(withCookie(cookie))).actor).toEqual({ type: "anonymous" });
    // …and cannot sign in again.
    expect(await apiError(() => signInByEmail("priya@example.test"))).toMatchObject({
      code: "ACCOUNT_UNAVAILABLE",
    });
  });

  it("resolves a parent Actor with their family", async () => {
    const parent = await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    const ctx = await resolveCtx(withCookie((await signInByEmail("priya@example.test")).cookie));
    expect(ctx.actor).toEqual({
      type: "parent",
      userId: parent.user.id,
      familyId: parent.family.id,
      status: "active",
    });
  });

  it("makes a parent verify their email before they can sign in, and sends the link", async () => {
    await createParent({ email: "new@example.test", password: TEST_PASSWORD, emailVerified: false });
    const refused = await apiError(() => signInByEmail("new@example.test"));
    expect(refused.status).toBe("FORBIDDEN");
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({ kind: "verify_email", to: "new@example.test" });
    expect(await db.select().from(session)).toHaveLength(0);
  });

  it("reads the caller's IP and request id from the headers", async () => {
    const ctx = await resolveCtx(
      new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1", "x-request-id": "req-12345678" }),
    );
    expect(ctx.ip).toBe("198.51.100.7");
    expect(ctx.requestId).toBe("req-12345678");
    // A request id that is not plainly safe to log is replaced.
    const odd = await resolveCtx(new Headers({ "x-request-id": "<script>alert(1)</script>" }));
    expect(odd.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("age on the Actor", () => {
  it("works out age from the birth month and year at the given time, in the younger direction", async () => {
    // Born November 2012: 13 until the end of November 2026, 14 from 1 December.
    await createLearner({
      username: "maya_k",
      password: TEST_PASSWORD,
      birthYear: 2012,
      birthMonth: 11,
      now: new Date("2026-11-15T12:00:00Z"),
    });
    const { cookie } = await signInLearner("maya_k");
    const november = await resolveCtx(withCookie(cookie), { now: new Date("2026-11-30T23:59:59Z") });
    const december = await resolveCtx(withCookie(cookie), { now: new Date("2026-12-01T00:00:00Z") });
    expect(november.actor).toMatchObject({ age: 13, safetyBand: "teen_13_15" });
    expect(december.actor).toMatchObject({ age: 14, safetyBand: "teen_13_15" });
  });

  it("keeps the stricter band until the daily job has caught up with a birthday", async () => {
    // Born October 2010: 16 from 1 November 2026. The stored band still says 13–15.
    const learner = await createLearner({
      username: "josh",
      password: TEST_PASSWORD,
      birthYear: 2010,
      birthMonth: 10,
      now: new Date("2026-10-15T12:00:00Z"),
    });
    expect(learner.profile.safetyBand).toBe("teen_13_15");
    const { cookie } = await signInLearner("josh");
    const now = new Date("2026-11-15T12:00:00Z");

    const stale = await resolveCtx(withCookie(cookie), { now });
    expect(stale.actor).toMatchObject({ age: 16, safetyBand: "teen_13_15" });

    await db
      .update(learnerProfile)
      .set({ safetyBand: "teen_16_17" })
      .where(eq(learnerProfile.userId, learner.user.id));
    const refreshed = await resolveCtx(withCookie(cookie), { now });
    expect(refreshed.actor).toMatchObject({ age: 16, safetyBand: "teen_16_17" });
  });

  it("never serves a learner whose stored birth date is under 13", async () => {
    const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD, age: 13 });
    const { cookie } = await signInLearner("maya_k");
    await db
      .update(learnerProfile)
      .set({ birthYear: 2020 })
      .where(eq(learnerProfile.userId, learner.user.id));
    expect((await resolveCtx(withCookie(cookie))).actor).toEqual({ type: "anonymous" });
  });
});

describe("account lockout", () => {
  it("locks sign-in for 15 minutes after five wrong passwords, and says the same thing to a right password", async () => {
    const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const locked: AccountLockedEvent[] = [];
    setAccountLockedHandler(async (event) => {
      locked.push(event);
    });

    for (let attempt = 1; attempt <= LOCKOUT_MAX_FAILURES; attempt++) {
      const refused = await apiError(() => signInLearner("maya_k", `wrong-password-${attempt}`));
      expect(refused.status).toBe("UNAUTHORIZED");
    }
    const row = (await db.select().from(user).where(eq(user.id, learner.user.id)))[0];
    expect(row?.failedSigninCount).toBe(5);
    const minutes = ((row?.lockedUntil?.getTime() ?? 0) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14.5);
    expect(minutes).toBeLessThanOrEqual(15);
    // A deliberate status change is not how this lock works.
    expect(row?.status).toBe("active");

    // The hook for notifying the parent fired exactly once.
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ userId: learner.user.id, kind: "learner" });

    // Right or wrong, the answer is now "locked".
    const right = await apiError(() => signInLearner("maya_k", TEST_PASSWORD));
    const wrong = await apiError(() => signInLearner("maya_k", "wrong-password-6"));
    expect(right).toMatchObject({ status: "TOO_MANY_REQUESTS", code: "ACCOUNT_LOCKED" });
    expect(wrong).toEqual(right);
    expect(right.message).toMatch(/15 minutes/);
    expect(await db.select().from(session)).toHaveLength(0);
  });

  it("lets the learner back in once the lock has passed", async () => {
    const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    await db
      .update(user)
      .set({
        failedSigninCount: 5,
        lockedUntil: new Date(Date.now() - 1000),
        failedSigninWindowStartedAt: new Date(Date.now() - 16 * 60_000),
      })
      .where(eq(user.id, learner.user.id));
    const { response } = await signInLearner("maya_k");
    expect(response.token).toBeTruthy();
    const row = (await db.select().from(user).where(eq(user.id, learner.user.id)))[0];
    expect(row).toMatchObject({ failedSigninCount: 0, lockedUntil: null, failedSigninWindowStartedAt: null });
  });

  it("clears the count after a successful sign-in", async () => {
    const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    await apiError(() => signInLearner("maya_k", "wrong-password-1"));
    await apiError(() => signInLearner("maya_k", "wrong-password-2"));
    await signInLearner("maya_k");
    const row = (await db.select().from(user).where(eq(user.id, learner.user.id)))[0];
    expect(row?.failedSigninCount).toBe(0);
  });

  it("does not end a session that is already signed in", async () => {
    await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const { cookie } = await signInLearner("maya_k");
    for (let attempt = 1; attempt <= LOCKOUT_MAX_FAILURES; attempt++) {
      await apiError(() => signInLearner("maya_k", `wrong-password-${attempt}`));
    }
    expect((await resolveCtx(withCookie(cookie))).actor.type).toBe("learner");
  });

  it("locks a parent's email sign-in in the same way", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    for (let attempt = 1; attempt <= LOCKOUT_MAX_FAILURES; attempt++) {
      await apiError(() => signInByEmail("priya@example.test", `wrong-password-${attempt}`));
    }
    expect(await apiError(() => signInByEmail("priya@example.test"))).toMatchObject({
      code: "ACCOUNT_LOCKED",
    });
  });

  it("recordFailedSignIn counts inside a 15-minute window and starts again after it", async () => {
    const learner = await createLearner();
    const t0 = new Date("2026-11-15T10:00:00Z");
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

    expect(await recordFailedSignIn(db, learner.user.id, at(0))).toMatchObject({
      failedCount: 1,
      lockedNow: false,
    });
    expect(await recordFailedSignIn(db, learner.user.id, at(5))).toMatchObject({
      failedCount: 2,
      lockedNow: false,
    });
    expect(await recordFailedSignIn(db, learner.user.id, at(14))).toMatchObject({
      failedCount: 3,
      lockedNow: false,
    });
    // 16 minutes after the first failure: a new window.
    expect(await recordFailedSignIn(db, learner.user.id, at(16))).toMatchObject({
      failedCount: 1,
      lockedNow: false,
      lockedUntil: null,
    });
    expect(await recordFailedSignIn(db, learner.user.id, at(17))).toMatchObject({ failedCount: 2 });
    expect(await recordFailedSignIn(db, learner.user.id, at(18))).toMatchObject({ failedCount: 3 });
    expect(await recordFailedSignIn(db, learner.user.id, at(19))).toMatchObject({
      failedCount: 4,
      lockedNow: false,
    });
    const fifth = await recordFailedSignIn(db, learner.user.id, at(20));
    expect(fifth).toMatchObject({ failedCount: 5, lockedNow: true });
    expect(fifth?.lockedUntil?.toISOString()).toBe(at(35).toISOString());

    await clearFailedSignIns(db, learner.user.id);
    const row = (await db.select().from(user).where(eq(user.id, learner.user.id)))[0];
    expect(row).toMatchObject({ failedSigninCount: 0, lockedUntil: null, failedSigninWindowStartedAt: null });
  });

  it("does not lose counts when attempts arrive at the same moment", async () => {
    const learner = await createLearner();
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => recordFailedSignIn(db, learner.user.id, now)),
    );
    expect(results.map((r) => r?.failedCount).sort()).toEqual([1, 2, 3, 4, 5]);
    const row = (await db.select().from(user).where(eq(user.id, learner.user.id)))[0];
    expect(row?.failedSigninCount).toBe(5);
    expect(row?.lockedUntil).not.toBeNull();
  });

  it("returns null for a user that does not exist, and a failing notice never breaks sign-in", async () => {
    expect(await recordFailedSignIn(db, "00000000-0000-4000-8000-000000000000", new Date())).toBeNull();

    const learner = await createLearner();
    setAccountLockedHandler(async () => {
      throw new Error("notifications are down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = new Date();
    for (let i = 0; i < 4; i++) await recordFailedSignIn(db, learner.user.id, now);
    await expect(recordFailedSignIn(db, learner.user.id, now)).resolves.toMatchObject({ lockedNow: true });
    warn.mockRestore();
  });
});

describe("staff: two-factor and the 12-hour session", () => {
  async function staffWithPassword(roles: Parameters<typeof createStaff>[0] = {}) {
    return createStaff({ email: "sam@example.test", password: TEST_PASSWORD, roles: ["editor"], ...roles });
  }

  /** Signs in, enrols TOTP and returns the verified session cookie plus the TOTP secret. */
  async function enrolTotp() {
    const first = await signInByEmail("sam@example.test");
    const enabled = await auth.api.enableTwoFactor({
      body: { password: TEST_PASSWORD },
      headers: withCookie(first.cookie),
    });
    if (!("totpURI" in enabled) || !enabled.totpURI) throw new Error("no TOTP URI");
    const secret = new URL(enabled.totpURI).searchParams.get("secret") ?? "";
    const verified = await auth.api.verifyTOTP({
      body: { code: totp(secret) },
      headers: withCookie(first.cookie),
      returnHeaders: true,
    });
    return { cookie: cookieHeader(verified.headers, first.cookie), secret, firstCookie: first.cookie };
  }

  it("gives staff a session that ends 12 hours after sign-in", async () => {
    await staffWithPassword();
    await signInByEmail("sam@example.test");
    const row = (await db.select().from(session))[0];
    const hours = ((row?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    expect(row?.absoluteExpiresAt?.getTime()).toBe(row?.expiresAt.getTime());
  });

  it("does not let using the session push it past 12 hours", async () => {
    await staffWithPassword();
    const { cookie } = await signInByEmail("sam@example.test");
    const before = (await db.select().from(session))[0];

    // Better Auth refreshes the expiry whenever the session is read; the ceiling holds.
    for (let i = 0; i < 3; i++) await auth.api.getSession({ headers: withCookie(cookie) });
    const after = (await db.select().from(session))[0];
    expect(after?.expiresAt.getTime()).toBe(before?.expiresAt.getTime());
    expect(after?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + STAFF_SESSION_SECONDS * 1000);
  });

  it("treats a staff session older than 12 hours as signed out, even if its expiry was somehow extended", async () => {
    await staffWithPassword();
    const { cookie } = await signInByEmail("sam@example.test");
    const later = new Date(Date.now() + STAFF_SESSION_SECONDS * 1000 + 60_000);
    expect((await resolveCtx(withCookie(cookie))).actor.type).toBe("staff");
    expect((await resolveCtx(withCookie(cookie), { now: later })).actor).toEqual({ type: "anonymous" });
  });

  it("a password alone gives a staff Actor that has not passed two-factor", async () => {
    const staff = await staffWithPassword({ roles: ["editor", "reviewer"] });
    const ctx = await resolveCtx(withCookie((await signInByEmail("sam@example.test")).cookie));
    expect(ctx.actor).toEqual({
      type: "staff",
      userId: staff.user.id,
      roles: ["editor", "reviewer"],
      twoFactorVerified: false,
    });
    if (ctx.actor.type !== "staff") throw new Error("expected staff");
    expect(() => assertStaffSecondFactor(ctx.actor as never, true)).toThrowError(
      expect.objectContaining({ code: "two_factor_required", status: 403 }),
    );
    // With STAFF_2FA_REQUIRED off the check passes, but the Actor still tells the truth.
    expect(assertStaffSecondFactor(ctx.actor as never, false)).toMatchObject({ twoFactorVerified: false });
  });

  it("marks the session as verified once TOTP is set up and confirmed", async () => {
    const staff = await staffWithPassword();
    const { cookie, firstCookie } = await enrolTotp();

    const ctx = await resolveCtx(withCookie(cookie));
    expect(ctx.actor).toMatchObject({ type: "staff", userId: staff.user.id, twoFactorVerified: true });
    // The password-only session it replaced is gone.
    expect((await resolveCtx(withCookie(firstCookie))).actor).toEqual({ type: "anonymous" });

    const rows = await db.select().from(session);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.twoFactorVerified).toBe(true);
    const hours = ((rows[0]?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(12);
  });

  it("asks for the code at every later sign-in and gives no session until it is right", async () => {
    await staffWithPassword();
    const { cookie: enrolled, secret } = await enrolTotp();
    await auth.api.signOut({ headers: withCookie(enrolled) });
    expect(await db.select().from(session)).toHaveLength(0);

    // Step 1: password. No session yet, only a short-lived challenge cookie.
    const challenge = await signInByEmail("sam@example.test");
    expect(challenge.response).toMatchObject({ twoFactorRedirect: true });
    expect(await db.select().from(session)).toHaveLength(0);
    expect((await resolveCtx(withCookie(challenge.cookie))).actor).toEqual({ type: "anonymous" });

    // A wrong code is refused.
    const wrong = await apiError(() =>
      auth.api.verifyTOTP({ body: { code: "000000" }, headers: withCookie(challenge.cookie) }),
    );
    expect(wrong.status).toBe("UNAUTHORIZED");
    expect(await db.select().from(session)).toHaveLength(0);

    // Step 2: the right code, asking to "trust this device", which we never honour.
    const verified = await auth.api.verifyTOTP({
      body: { code: totp(secret), trustDevice: true },
      headers: withCookie(challenge.cookie),
      returnHeaders: true,
    });
    const cookie = cookieHeader(verified.headers, challenge.cookie);
    expect(cookie).not.toMatch(/trust_device/);
    const ctx = await resolveCtx(withCookie(cookie));
    expect(ctx.actor).toMatchObject({ type: "staff", twoFactorVerified: true });

    // So the next sign-in is challenged again.
    await auth.api.signOut({ headers: withCookie(cookie) });
    const again = await signInByEmail("sam@example.test");
    expect(again.response).toMatchObject({ twoFactorRedirect: true });
  });

  it("never sends staff or learners a magic link, and says nothing about why", async () => {
    await staffWithPassword();
    const result = await auth.api.signInMagicLink({
      body: { email: "sam@example.test", callbackURL: "/studio" },
      headers: new Headers(),
    });
    expect(result).toEqual({ status: true });
    const unknown = await auth.api.signInMagicLink({
      body: { email: "nobody@example.test", callbackURL: "/parent" },
      headers: new Headers(),
    });
    expect(unknown).toEqual({ status: true });
    expect(sentEmails).toEqual([]);
  });

  it("lets a parent switch on two-step sign-in, but not a learner", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    const parent = await signInByEmail("priya@example.test");
    const enabled = await auth.api.enableTwoFactor({
      body: { password: TEST_PASSWORD },
      headers: withCookie(parent.cookie),
    });
    expect(enabled).toHaveProperty("totpURI");

    await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const learner = await signInLearner("maya_k");
    const refused = await apiError(() =>
      auth.api.enableTwoFactor({ body: { password: TEST_PASSWORD }, headers: withCookie(learner.cookie) }),
    );
    expect(refused).toMatchObject({ status: "FORBIDDEN", code: "TWO_FACTOR_NOT_AVAILABLE" });
    expect(await db.select().from(twoFactor)).toHaveLength(1); // the parent's only
  });

  it("gives no Actor to staff who are not active", async () => {
    const staff = await staffWithPassword();
    const { cookie } = await signInByEmail("sam@example.test");
    await db.update(user).set({ status: "paused" }).where(eq(user.id, staff.user.id));
    expect((await resolveCtx(withCookie(cookie))).actor).toEqual({ type: "anonymous" });
  });
});

describe("parents: magic link and password reset", () => {
  it("emails a parent a one-time link that signs them in", async () => {
    const parent = await createParent({ email: "priya@example.test" }); // no password at all
    await auth.api.signInMagicLink({
      body: { email: "priya@example.test", callbackURL: "/parent" },
      headers: new Headers(),
    });
    expect(sentEmails).toHaveLength(1);
    const email = sentEmails[0];
    expect(email).toMatchObject({ kind: "magic_link", to: "priya@example.test" });

    const token = new URL(email?.url ?? "").searchParams.get("token") ?? "";
    const verified = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers(),
      returnHeaders: true,
    });
    const ctx = await resolveCtx(withCookie(cookieHeader(verified.headers)));
    expect(ctx.actor).toMatchObject({ type: "parent", userId: parent.user.id });

    // Single use.
    await expect(
      auth.api.magicLinkVerify({ query: { token }, headers: new Headers(), returnHeaders: true }),
    ).rejects.toBeDefined();
  });

  it("stores only a hash of the magic-link token", async () => {
    await createParent({ email: "priya@example.test" });
    await auth.api.signInMagicLink({ body: { email: "priya@example.test" }, headers: new Headers() });
    const token = new URL(sentEmails[0]?.url ?? "").searchParams.get("token") ?? "";
    const rows = await db.execute<{ identifier: string; value: string }>(
      `select identifier, value from verification` as never,
    );
    expect(token.length).toBeGreaterThan(20);
    expect(JSON.stringify(Array.from(rows))).not.toContain(token);
  });

  it("does not create an account from a magic link for an unknown address", async () => {
    await auth.api.signInMagicLink({ body: { email: "stranger@example.test" }, headers: new Headers() });
    expect(sentEmails).toEqual([]);
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("lets a parent reset their own password by email, applying the password policy", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD });
    const { cookie: oldCookie } = await signInByEmail("priya@example.test");

    await auth.api.requestPasswordReset({ body: { email: "priya@example.test", redirectTo: "/reset" } });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({ kind: "reset_password", to: "priya@example.test" });
    const token = new URL(sentEmails[0]?.url ?? "").pathname.split("/").pop() ?? "";

    const weak = await apiError(() => auth.api.resetPassword({ body: { token, newPassword: "qwertyuiop" } }));
    expect(weak).toMatchObject({ status: "BAD_REQUEST", code: "PASSWORD_TOO_COMMON" });
    const short = await apiError(() => auth.api.resetPassword({ body: { token, newPassword: "short" } }));
    expect(short.status).toBe("BAD_REQUEST");

    await auth.api.resetPassword({ body: { token, newPassword: "meadow-kettle-comet-77" } });
    // Signed out everywhere, old password dead, new one works.
    expect((await resolveCtx(withCookie(oldCookie))).actor).toEqual({ type: "anonymous" });
    expect((await apiError(() => signInByEmail("priya@example.test"))).status).toBe("UNAUTHORIZED");
    expect((await signInByEmail("priya@example.test", "meadow-kettle-comet-77")).response.token).toBeTruthy();
  });
});

describe("accounts are created only by our services", () => {
  it("refuses Better Auth's own sign-up", async () => {
    const refused = await apiError(() =>
      auth.api.signUpEmail({ body: { email: "new@example.test", password: TEST_PASSWORD, name: "New" } }),
    );
    expect(refused.status).toBe("BAD_REQUEST");
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it.each(["/sign-up/email", "/update-user", "/change-email", "/delete-user", "/is-username-available"])(
    "does not serve %s over HTTP",
    async (path) => {
      const response = await auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({
            email: "x@example.test",
            password: TEST_PASSWORD,
            name: "X",
            username: "maya_k",
          }),
        }),
      );
      expect(response.status).toBe(404);
    },
  );

  it("serves sign-in over HTTP and sets an HttpOnly session cookie", async () => {
    await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/username", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ username: "maya_k", password: TEST_PASSWORD }),
      }),
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const body = (await response.json()) as { user: { email: unknown; kind: unknown } };
    expect(body.user.email).toBeNull();
    expect(body.user.kind).toBe("learner");
  });

  it("createAccount enforces the password policy and the shape of a username", async () => {
    await expect(
      createAccount(db, { kind: "learner", name: "Maya", username: "maya_k", password: "short" }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fieldErrors: { password: [expect.stringMatching(/too short/i)] },
    });
    await expect(
      createAccount(db, { kind: "learner", name: "Maya", username: "maya_k", password: "maya_k-2026!" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      createAccount(db, { kind: "learner", name: "Maya", username: "no spaces please" }),
    ).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(createAccount(db, { kind: "learner", name: "Maya" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(createAccount(db, { kind: "parent", name: "Priya" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      createAccount(db, { kind: "parent", name: "Priya", email: "someone@learner.invalid" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("createAccount does not reveal that an email already has an account", async () => {
    await createParent({ email: "priya@example.test" });
    const error = await createAccount(db, {
      kind: "parent",
      name: "Other",
      email: "PRIYA@example.test",
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "conflict" });
    expect((error as Error).message).not.toMatch(/already (exists|registered|taken|in use)/i);
  });

  it("createAccount rolls back with the caller's transaction", async () => {
    await expect(
      db.transaction(async (tx) => {
        await createAccount(tx, {
          kind: "learner",
          name: "Maya",
          username: "maya_k",
          password: TEST_PASSWORD,
        });
        throw new Error("something later in sign-up failed");
      }),
    ).rejects.toThrow("something later in sign-up failed");
    expect(await db.select().from(user)).toHaveLength(0);
    expect(await db.select().from(account)).toHaveLength(0);
  });

  it("setAccountPassword replaces the password, signs the learner out and lifts a lock", async () => {
    const learner = await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const { cookie } = await signInLearner("maya_k");
    await db
      .update(user)
      .set({ failedSigninCount: 5, lockedUntil: new Date(Date.now() + 600_000) })
      .where(eq(user.id, learner.user.id));

    await expect(setAccountPassword(db, learner.user.id, "qwertyuiop")).rejects.toMatchObject({
      code: "invalid_input",
    });
    await setAccountPassword(db, learner.user.id, "meadow-kettle-comet-77");

    expect((await resolveCtx(withCookie(cookie))).actor).toEqual({ type: "anonymous" });
    expect((await apiError(() => signInLearner("maya_k", TEST_PASSWORD))).status).toBe("UNAUTHORIZED");
    expect((await signInLearner("maya_k", "meadow-kettle-comet-77")).response.token).toBeTruthy();
    expect(await db.select().from(account)).toHaveLength(1);
  });

  it("setAccountPassword gives a first password to a learner who was created without one", async () => {
    const learner = await createLearner({ username: "maya_k" });
    expect(await db.select().from(account)).toHaveLength(0);
    await setAccountPassword(db, learner.user.id, "meadow-kettle-comet-77");
    expect((await signInLearner("maya_k", "meadow-kettle-comet-77")).response.token).toBeTruthy();
  });
});

describe("rate limiting on auth routes (production and preview)", () => {
  it("counts requests in the database and answers 429 once the limit is passed", async () => {
    const limited = createAuth({ rateLimited: true });
    await createLearner({ username: "maya_k", password: TEST_PASSWORD });
    const attempt = () =>
      limited.handler(
        new Request("http://localhost:3000/api/auth/sign-in/username", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            "x-forwarded-for": "198.51.100.23",
          },
          body: JSON.stringify({ username: "maya_k", password: "wrong-password-0" }),
        }),
      );

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt()).status);

    // Better Auth allows three sign-in attempts per ten seconds from one address.
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429, 429]);
    const rows = await db.select().from(authRateLimit);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toContain("198.51.100.23");
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-/);
    // Throttled requests never reached the password check, so they did not count towards the lock.
    expect((await db.select().from(user))[0]?.failedSigninCount).toBe(3);
  });
});

describe("systemCtx", () => {
  it("builds a system Actor for a job", () => {
    const pinned = new Date("2026-11-15T03:00:00Z");
    const ctx = systemCtx("retention.sweep", { now: pinned });
    expect(ctx.actor).toEqual({ type: "system", job: "retention.sweep" });
    expect(ctx.now).toBe(pinned);
    expect(ctx.requestId).toMatch(/^job:retention\.sweep:/);
    expect(ctx.ip).toBeUndefined();
  });
});
