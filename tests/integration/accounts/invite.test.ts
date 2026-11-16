import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { account, auditLog, inviteCode } from "@/server/db/schema";
import { addChild } from "@/server/services/children";
import { INVITE_MAX_FAILED_ATTEMPTS, createInviteCode, hashInviteCode, peekInviteCode, redeemInviteCode, verifyInviteCode } from "@/server/services/invite";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createLearner, createParent } from "../../helpers/factories";
import { NOW, addSession, birthFor, daysFrom, freshAccountsDb, mockedEntitlement, sessionCount } from "./helpers";

vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));

beforeEach(async () => {
  await freshAccountsDb();
});
afterAll(async () => {
  await closeDb();
});

const NEW_PASSWORD = "meadow-kettle-comet-77";
/** A code of the right shape that is certainly not `code`. */
const wrongCode = (code: string) => (code.startsWith("A") ? `B${code.slice(1)}` : `A${code.slice(1)}`);
/** Each call comes from a different address, so the per-caller limit does not get in the way of the per-code one. */
let caller = 0;
const anon = (now: Date = NOW) => testCtx(undefined, { now, ip: `198.51.100.${(caller++ % 250) + 1}` });

async function childWithInvite() {
  const { actor, family } = await createParent();
  const result = await addChild(testCtx(actor, { now: NOW }), { ...birthFor(14), nickname: "Maya", username: "pixel_wren_77", password: null });
  if (!result.invite) throw new Error("expected an invite");
  return { parent: actor, familyId: family.id, learnerId: result.learnerId, code: result.invite.code, formatted: result.invite.formatted };
}

describe("redeeming an invite code", () => {
  it("lets the child choose their own password with the code and their username", async () => {
    const { learnerId, formatted } = await childWithInvite();
    const result = await redeemInviteCode(anon(), { username: " Pixel_Wren_77 ", code: formatted.toLowerCase(), password: NEW_PASSWORD });
    expect(result).toEqual({ learnerId });
    expect((await getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: NEW_PASSWORD } }))?.token).toBeTruthy();
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "invite.redeem"))).toHaveLength(1);
  });

  it("is single use", async () => {
    const { code, learnerId } = await childWithInvite();
    await redeemInviteCode(anon(), { username: "pixel_wren_77", code, password: NEW_PASSWORD });
    const again = redeemInviteCode(anon(), { username: "pixel_wren_77", code, password: "another-good-pass-91" });
    await expect(again).rejects.toMatchObject({ code: "conflict" });
    await expect(again).rejects.toThrow(/already been used/);
    // The first password still stands.
    expect((await getAuth().api.signInUsername({ body: { username: "pixel_wren_77", password: NEW_PASSWORD } }))?.token).toBeTruthy();
    expect((await db.select().from(inviteCode).where(eq(inviteCode.learnerId, learnerId)))[0]?.usedAt).toEqual(NOW);
  });

  it("only one of two redemptions at the same moment wins", async () => {
    const { code } = await childWithInvite();
    const results = await Promise.allSettled([
      redeemInviteCode(anon(), { username: "pixel_wren_77", code, password: NEW_PASSWORD }),
      redeemInviteCode(anon(), { username: "pixel_wren_77", code, password: "another-good-pass-91" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(account)).toHaveLength(1);
  });

  it("works for 72 hours and not a moment longer", async () => {
    const { code } = await childWithInvite();
    const justBefore = new Date(NOW.getTime() + 72 * 60 * 60 * 1000 - 1000);
    await expect(verifyInviteCode(anon(justBefore), { username: "pixel_wren_77", code })).resolves.toMatchObject({ learnerId: expect.any(String) });

    const atExpiry = daysFrom(NOW, 3);
    const late = redeemInviteCode(anon(atExpiry), { username: "pixel_wren_77", code, password: NEW_PASSWORD });
    await expect(late).rejects.toMatchObject({ code: "conflict" });
    await expect(late).rejects.toThrow(/72 hours/);
    expect(await db.select().from(account)).toHaveLength(0);
  });

  it("must be entered with the username it was made for", async () => {
    const { code, familyId } = await childWithInvite();
    await createLearner({ familyId, username: "calm_falcon_30" });
    await expect(redeemInviteCode(anon(), { username: "calm_falcon_30", code, password: NEW_PASSWORD })).rejects.toMatchObject({ code: "invalid_input" });
    // The same answer for a username that does not exist: nothing is confirmed either way.
    const unknown = (await redeemInviteCode(anon(), { username: "nobody_here_1", code, password: NEW_PASSWORD }).catch((e: unknown) => e)) as Error;
    const known = (await redeemInviteCode(anon(), { username: "calm_falcon_30", code, password: NEW_PASSWORD }).catch((e: unknown) => e)) as Error;
    expect(unknown.message).toBe(known.message);
  });

  it("counts wrong tries and switches the code off after five, even for the right code", async () => {
    const { code, learnerId } = await childWithInvite();
    for (let attempt = 1; attempt < INVITE_MAX_FAILED_ATTEMPTS; attempt++) {
      await expect(verifyInviteCode(anon(), { username: "pixel_wren_77", code: wrongCode(code) })).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect((await db.select().from(inviteCode).where(eq(inviteCode.learnerId, learnerId)))[0]).toMatchObject({ failedAttempts: 4, revokedAt: null });

    // The fifth wrong try switches it off and says so.
    const fifth = verifyInviteCode(anon(), { username: "pixel_wren_77", code: wrongCode(code) });
    await expect(fifth).rejects.toMatchObject({ code: "rate_limited" });
    await expect(fifth).rejects.toThrow(/switched off/);
    const row = (await db.select().from(inviteCode).where(eq(inviteCode.learnerId, learnerId)))[0];
    expect(row?.failedAttempts).toBe(INVITE_MAX_FAILED_ATTEMPTS);
    expect(row?.revokedAt).not.toBeNull();

    await expect(redeemInviteCode(anon(), { username: "pixel_wren_77", code, password: NEW_PASSWORD })).rejects.toMatchObject({ code: "conflict" });
    expect(await db.select().from(account)).toHaveLength(0);
  });

  it("does not lose a count when wrong tries arrive together", async () => {
    const { code, learnerId } = await childWithInvite();
    await Promise.allSettled([1, 2, 3].map(() => verifyInviteCode(anon(), { username: "pixel_wren_77", code: wrongCode(code) })));
    expect((await db.select().from(inviteCode).where(eq(inviteCode.learnerId, learnerId)))[0]?.failedAttempts).toBe(3);
  });

  it("rate limits one caller across codes and usernames", async () => {
    const { code } = await childWithInvite();
    const sameCaller = testCtx(undefined, { now: NOW, ip: "203.0.113.77" });
    const outcomes: string[] = [];
    for (let i = 0; i < 22; i++) {
      const error = (await verifyInviteCode(sameCaller, { username: `nobody_here_${i}`, code }).catch((e: unknown) => e)) as { code?: string };
      outcomes.push(error.code ?? "ok");
    }
    expect(outcomes.slice(0, 20).every((c) => c === "invalid_input")).toBe(true);
    expect(outcomes.slice(20)).toEqual(["rate_limited", "rate_limited"]);
  });

  it("a password that breaks the rules does not use up the code or count as a wrong try", async () => {
    const { code, learnerId } = await childWithInvite();
    await expect(redeemInviteCode(anon(), { username: "pixel_wren_77", code, password: "pixel_wren_77" })).rejects.toMatchObject({ code: "invalid_input", fieldErrors: { password: expect.any(Array) } });
    expect((await db.select().from(inviteCode).where(eq(inviteCode.learnerId, learnerId)))[0]).toMatchObject({ usedAt: null, failedAttempts: 0 });
    await expect(redeemInviteCode(anon(), { username: "pixel_wren_77", code, password: NEW_PASSWORD })).resolves.toEqual({ learnerId });
  });

  it("refuses something that is not shaped like a code without looking anything up", async () => {
    await childWithInvite();
    await expect(verifyInviteCode(anon(), { username: "pixel_wren_77", code: "nope" })).rejects.toMatchObject({ code: "invalid_input", fieldErrors: { code: expect.any(Array) } });
  });

  it("signs out anyone using the account when the code is redeemed", async () => {
    const { code, learnerId } = await childWithInvite();
    await addSession(learnerId);
    await redeemInviteCode(anon(), { username: "pixel_wren_77", code, password: NEW_PASSWORD });
    expect(await sessionCount(learnerId)).toBe(0);
  });
});

describe("issuing and peeking", () => {
  it("a new code switches off the earlier unused one", async () => {
    const { parent, familyId, learnerId, code } = await childWithInvite();
    const second = await createInviteCode({ now: NOW }, { learnerId, familyId, createdBy: parent.userId }, db);
    // Regression: both codes were made in the same instant, so "the newest row" could not tell them apart.
    await expect(verifyInviteCode(anon(), { username: "pixel_wren_77", code: second.code })).resolves.toMatchObject({ learnerId });
    const old = verifyInviteCode(anon(), { username: "pixel_wren_77", code });
    await expect(old).rejects.toMatchObject({ code: "conflict" });
    await expect(old).rejects.toThrow(/replaced by a newer one/);
    // Trying the old code is not a wrong guess: it does not count against the new one.
    expect((await db.select().from(inviteCode).where(eq(inviteCode.codeHash, hashInviteCode(second.code))))[0]?.failedAttempts).toBe(0);
  });

  it("peek says only usable, expired or unknown, and never counts as a try", async () => {
    const { code, learnerId } = await childWithInvite();
    expect(await peekInviteCode(anon(), code)).toBe("usable");
    expect(await peekInviteCode(anon(daysFrom(NOW, 4)), code)).toBe("expired");
    expect(await peekInviteCode(anon(), wrongCode(code))).toBe("unknown");
    expect(await peekInviteCode(anon(), "not a code")).toBe("unknown");
    expect((await db.select().from(inviteCode).where(eq(inviteCode.learnerId, learnerId)))[0]?.failedAttempts).toBe(0);

    await db.update(inviteCode).set({ usedAt: NOW }).where(eq(inviteCode.codeHash, hashInviteCode(code)));
    expect(await peekInviteCode(anon(), code)).toBe("unknown");
  });
});
