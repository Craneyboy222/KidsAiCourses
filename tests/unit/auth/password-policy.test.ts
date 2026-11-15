import { describe, expect, it, vi } from "vitest";
import { COMMON_PASSWORDS } from "@/server/auth/common-passwords";
import {
  HIBP_RANGE_URL,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPassword,
  checkPasswordLocal,
  containsPersonalDetail,
  hibpCountInRange,
  hibpHashParts,
  isBreachedPassword,
  isCommonPassword,
  passwordLength,
  type FetchLike,
} from "@/server/auth/password-policy";

const GOOD = "orbit-lantern-walrus-42";

/** SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8. */
const PASSWORD_PREFIX = "5BAA6";
const PASSWORD_SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

function rangeResponse(body: string, ok = true, status = 200): FetchLike {
  return vi.fn(async () => ({ ok, status, text: async () => body }));
}

describe("the bundled common-password list", () => {
  it("holds at least 1,000 passwords", () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThanOrEqual(1000);
  });

  it("holds only lower-case entries that could pass the length rule", () => {
    for (const entry of COMMON_PASSWORDS) {
      expect(entry).toBe(entry.toLowerCase());
      expect(entry.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(entry.length).toBeLessThanOrEqual(PASSWORD_MAX_LENGTH);
    }
  });

  it("includes the classics", () => {
    for (const classic of ["1234567890", "qwertyuiop", "1q2w3e4r5t", "password12", "basketball"]) {
      expect(COMMON_PASSWORDS.has(classic)).toBe(true);
    }
  });
});

describe("checkPasswordLocal", () => {
  it("accepts a long, unusual password", () => {
    expect(checkPasswordLocal(GOOD)).toEqual({ ok: true });
  });

  it("requires at least 10 characters", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    const nine = checkPasswordLocal("xk7#Qp2zL");
    expect(nine).toMatchObject({ ok: false, problem: "too_short" });
    expect(checkPasswordLocal("xk7#Qp2zLm")).toEqual({ ok: true });
    expect(checkPasswordLocal("")).toMatchObject({ ok: false, problem: "too_short" });
  });

  it("rejects more than 128 characters", () => {
    const base = "xk7#Qp2zLm";
    expect(checkPasswordLocal(base.repeat(12) + "12345678")).toEqual({ ok: true }); // 128
    expect(checkPasswordLocal(base.repeat(12) + "123456789")).toMatchObject({
      ok: false,
      problem: "too_long",
    }); // 129
  });

  it("counts characters the way a person does, so emoji do not count double", () => {
    expect(passwordLength("🦊🦊🦊🦊🦊")).toBe(5);
    expect(checkPasswordLocal("🦊🦊🦊🦊🦊🦊🦊🦊🦊")).toMatchObject({ ok: false, problem: "too_short" }); // 9 foxes
    expect(checkPasswordLocal("🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊")).toEqual({ ok: true }); // 10 foxes
  });

  it("rejects a common password whatever its capitalisation or surrounding spaces", () => {
    expect(checkPasswordLocal("qwertyuiop")).toMatchObject({ ok: false, problem: "too_common" });
    expect(checkPasswordLocal("QwErTyUiOp")).toMatchObject({ ok: false, problem: "too_common" });
    expect(checkPasswordLocal("1234567890")).toMatchObject({ ok: false, problem: "too_common" });
    expect(isCommonPassword("  Password12  ")).toBe(true);
    expect(isCommonPassword(GOOD)).toBe(false);
  });

  it("checks length before the list, so a short common password is reported as too short", () => {
    expect(checkPasswordLocal("password")).toMatchObject({ ok: false, problem: "too_short" });
  });

  it("rejects a password built from the username, nickname or email name", () => {
    expect(checkPasswordLocal("mayak14!!2026", { username: "maya.k14" })).toMatchObject({
      ok: false,
      problem: "contains_personal_detail",
    });
    expect(checkPasswordLocal("PriyaShah-2026", { email: "priya.shah@example.test" })).toMatchObject({
      ok: false,
      problem: "contains_personal_detail",
    });
    expect(checkPasswordLocal("Joshua_2009!", { name: "Joshua" })).toMatchObject({
      ok: false,
      problem: "contains_personal_detail",
    });
  });

  it("allows a long passphrase that merely mentions the username", () => {
    expect(containsPersonalDetail("maya-likes-purple-otters-a-lot", { username: "maya" })).toBe(false);
    expect(checkPasswordLocal("maya-likes-purple-otters-a-lot", { username: "maya" })).toEqual({ ok: true });
  });

  it("ignores very short personal details, which appear in passwords by chance", () => {
    expect(containsPersonalDetail("jo-walrus-42", { username: "jo", name: "Jo" })).toBe(false);
  });

  it("gives a message that says what happened and what to try", () => {
    const result = checkPasswordLocal("short");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/too short/i);
      expect(result.message).toMatch(/at least 10 characters/i);
    }
  });
});

describe("Have I Been Pwned range check", () => {
  it("splits the SHA-1 hash into a five-character prefix and the rest", () => {
    expect(hibpHashParts("password")).toEqual({ prefix: PASSWORD_PREFIX, suffix: PASSWORD_SUFFIX });
  });

  it("finds a suffix in a range response, ignoring case and line endings", () => {
    const body = `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${PASSWORD_SUFFIX}:9545824\r\n011053FD0102E94D6AE2F8B83D76FAF94F6:1`;
    expect(hibpCountInRange(body, PASSWORD_SUFFIX)).toBe(9545824);
    expect(hibpCountInRange(body, PASSWORD_SUFFIX.toLowerCase())).toBe(9545824);
    expect(hibpCountInRange(body, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toBe(0);
  });

  it("treats a padding row (count 0) as not breached", () => {
    expect(hibpCountInRange(`${PASSWORD_SUFFIX}:0`, PASSWORD_SUFFIX)).toBe(0);
  });

  it("sends only the five-character prefix, never the password or the full hash", async () => {
    const fetchImpl = rangeResponse(`${PASSWORD_SUFFIX}:3`);
    await expect(isBreachedPassword("password", fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe(`${HIBP_RANGE_URL}${PASSWORD_PREFIX}`);
    expect(url).not.toContain(PASSWORD_SUFFIX);
    // Everything after the fixed address is the prefix and nothing more.
    expect(String(url).slice(HIBP_RANGE_URL.length)).toBe(PASSWORD_PREFIX);
    expect(init?.headers).toEqual({ "Add-Padding": "true" });
  });

  it("returns false when the suffix is not in the range", async () => {
    await expect(isBreachedPassword("password", rangeResponse("ABCDEF:2"))).resolves.toBe(false);
  });

  it("returns null, not an error, when the service is down or unreachable", async () => {
    await expect(isBreachedPassword("password", rangeResponse("", false, 503))).resolves.toBeNull();
    const offline: FetchLike = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(isBreachedPassword("password", offline)).resolves.toBeNull();
  });
});

describe("checkPassword", () => {
  it("makes no network call unless the breach check is switched on (decision D10)", async () => {
    const fetchImpl = rangeResponse(`${hibpHashParts(GOOD).suffix}:5`);
    await expect(checkPassword(GOOD, { breachCheck: "local", fetchImpl })).resolves.toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a breached password when the breach check is on", async () => {
    const fetchImpl = rangeResponse(`${hibpHashParts(GOOD).suffix}:5`);
    const result = await checkPassword(GOOD, { breachCheck: "hibp", fetchImpl });
    expect(result).toMatchObject({ ok: false, problem: "breached" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts a password that is not in the breach corpus", async () => {
    const fetchImpl = rangeResponse("0000000000000000000000000000000000A:1");
    await expect(checkPassword(GOOD, { breachCheck: "hibp", fetchImpl })).resolves.toEqual({ ok: true });
  });

  it("runs the local rules first and skips the network when they fail", async () => {
    const fetchImpl = rangeResponse("");
    const result = await checkPassword("qwertyuiop", { breachCheck: "hibp", fetchImpl });
    expect(result).toMatchObject({ ok: false, problem: "too_common" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not block sign-up when the breach service cannot be reached", async () => {
    const offline: FetchLike = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(checkPassword(GOOD, { breachCheck: "hibp", fetchImpl: offline })).resolves.toEqual({
      ok: true,
    });
  });

  it("passes the account's details through to the local rules", async () => {
    const result = await checkPassword("mayak14!!2026", {
      breachCheck: "local",
      context: { username: "maya.k14" },
    });
    expect(result).toMatchObject({ ok: false, problem: "contains_personal_detail" });
  });
});
