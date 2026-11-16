import { describe, expect, it } from "vitest";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_MAX_FAILED_ATTEMPTS,
  INVITE_TTL_HOURS,
  formatInviteCode,
  hashInviteCode,
  inviteCodeEntropyBits,
  inviteExpiresAt,
  inviteState,
  isInviteCodeShape,
  normaliseInviteCode,
} from "@/server/services/invite";
import { newCode } from "@/server/crypto";

const now = new Date("2026-11-16T10:00:00Z");
const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000);
const fresh = { usedAt: null, revokedAt: null, expiresAt: hours(72), failedAttempts: 0 };

describe("invite code shape", () => {
  it("uses an alphabet with no look-alike characters", () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(31);
    for (const confusing of ["0", "O", "1", "I", "L"]) expect(INVITE_CODE_ALPHABET).not.toContain(confusing);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(INVITE_CODE_ALPHABET.length);
  });

  it("the codes the kernel issues always have the expected shape", () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode(INVITE_CODE_LENGTH);
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(isInviteCodeShape(code), code).toBe(true);
    }
  });

  it("treats spaces, hyphens and lower case as the same code", () => {
    expect(normaliseInviteCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normaliseInviteCode(" ABCD EFGH ")).toBe("ABCDEFGH");
    expect(hashInviteCode("abcd-efgh")).toBe(hashInviteCode("ABCDEFGH"));
    expect(hashInviteCode("ABCDEFGH")).not.toBe(hashInviteCode("ABCDEFGJ"));
  });

  it("recognises what cannot be a code without looking anything up", () => {
    expect(isInviteCodeShape("ABCD-EFGH")).toBe(true);
    expect(isInviteCodeShape("ABCDEFG")).toBe(false); // too short
    expect(isInviteCodeShape("ABCDEFGHJ")).toBe(false); // too long
    expect(isInviteCodeShape("ABCD-EFG0")).toBe(false); // zero is never issued
    expect(isInviteCodeShape("ABCD-EFGI")).toBe(false); // nor is I
    expect(isInviteCodeShape("")).toBe(false);
  });

  it("shows a code in two halves", () => {
    expect(formatInviteCode("abcdefgh")).toBe("ABCD-EFGH");
    expect(formatInviteCode("ABCD-EFGH")).toBe("ABCD-EFGH");
  });

  it("never stores the code itself", () => {
    const hash = hashInviteCode("ABCDEFGH");
    expect(hash).not.toContain("ABCDEFGH");
    expect(hash.length).toBeGreaterThanOrEqual(40);
  });
});

describe("invite code maths", () => {
  it("lasts exactly 72 hours", () => {
    expect(INVITE_TTL_HOURS).toBe(72);
    expect(inviteExpiresAt(now).getTime() - now.getTime()).toBe(72 * 60 * 60 * 1000);
  });

  it("has close to 40 bits of entropy, so guessing needs the attempt limit to matter", () => {
    expect(inviteCodeEntropyBits()).toBeCloseTo(8 * Math.log2(31), 6);
    expect(inviteCodeEntropyBits()).toBeGreaterThan(39);
    // Five tries against one code: the chance of a hit is about five in 850 billion.
    const chance = INVITE_MAX_FAILED_ATTEMPTS / 2 ** inviteCodeEntropyBits();
    expect(chance).toBeLessThan(1e-11);
  });

  it("is usable until the moment it expires, and not after", () => {
    expect(inviteState(fresh, now)).toBe("usable");
    expect(inviteState(fresh, hours(71.99))).toBe("usable");
    expect(inviteState(fresh, hours(72))).toBe("expired");
    expect(inviteState(fresh, hours(100))).toBe("expired");
  });

  it("is single use", () => {
    expect(inviteState({ ...fresh, usedAt: now }, now)).toBe("used");
    // Used wins over everything else, so the message can say "already used".
    expect(inviteState({ ...fresh, usedAt: now, revokedAt: now, expiresAt: hours(-1) }, now)).toBe("used");
  });

  it("is switched off when revoked or after five wrong tries", () => {
    expect(inviteState({ ...fresh, revokedAt: now }, now)).toBe("revoked");
    expect(inviteState({ ...fresh, failedAttempts: INVITE_MAX_FAILED_ATTEMPTS - 1 }, now)).toBe("usable");
    expect(inviteState({ ...fresh, failedAttempts: INVITE_MAX_FAILED_ATTEMPTS }, now)).toBe("revoked");
  });
});
