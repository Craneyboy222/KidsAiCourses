import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FALLBACK_CRISIS_SCRIPT, assertCrisisScript, getCrisisScript, openCaseWithRetry, parseCrisisScript, renderCrisisText } from "@/server/ai/crisis";
import { detectCrisis } from "@/server/ai/moderation";

const raw = readFileSync("content/prompts/crisis-script.v1.md", "utf8");

describe("the crisis script is fixed, versioned data", () => {
  const script = parseCrisisScript(raw);

  it("has every UK signpost the spec requires", () => {
    const text = renderCrisisText(script);
    expect(text).toContain("Childline");
    expect(text).toContain("0800 1111");
    expect(text).toContain("Samaritans");
    expect(text).toContain("116 123");
    expect(text).toContain("SHOUT to 85258");
    expect(text).toMatch(/in danger right now, call 999/);
    expect(text).toMatch(/adult you trust/);
    expect(script.version).toBe("crisis-script.v1");
  });

  it("every number is a tappable link", () => {
    const hrefs = [...script.contacts, script.emergency.contact].map((c) => c.href);
    expect(hrefs).toEqual(["tel:08001111", "tel:116123", "sms:85258?body=SHOUT", "tel:999"]);
  });

  it("is short, calm and says plainly that Coach is an AI", () => {
    const text = renderCrisisText(script);
    expect(text.split(/\s+/).length).toBeLessThan(260);
    expect(text).toMatch(/I'm an AI/);
    expect(text).toMatch(/You're not in trouble/);
    expect(text).not.toMatch(/!/);
  });

  it("the built-in fallback passes the same checks, and is used if the file cannot be loaded", () => {
    expect(() => assertCrisisScript(FALLBACK_CRISIS_SCRIPT)).not.toThrow();
    expect(getCrisisScript().contacts.map((c) => c.name)).toEqual(["Childline", "Samaritans", "Shout"]);
  });

  it("a script with a signpost missing is rejected", () => {
    expect(() => parseCrisisScript(raw.replace(/0800 1111/g, "0800 0000"))).toThrow(/Childline/);
    expect(() => parseCrisisScript(raw.replace(/999/g, "111"))).toThrow(/999/);
    expect(() => parseCrisisScript(raw.replace(/adult you trust/g, "someone"))).toThrow(/trusted adult/);
  });
});

describe("crisis detection (the local check behind the safety net)", () => {
  it.each([
    "i want to kill myself",
    "ngl i just wanna kms",
    "everyone would be better off without me tbh",
    "my stepdad comes into my room at night and i hate it",
    "theres this guy on discord hes 24 and he keeps asking me for pics",
    "hes outside my house rn and im scared",
    "i took loads of paracetamol like an hour ago",
  ])("detects: %s", (text) => {
    expect(detectCrisis(text, "teen_13_15")).not.toBeNull();
    expect(detectCrisis(text, "adult_18")).not.toBeNull();
  });

  it.each(["the timer is killing me", "how do i end the countdown early", "my laptop died", "im so done with this bug"])("ignores: %s", (text) => {
    expect(detectCrisis(text, "teen_13_15")).toBeNull();
  });
});

describe("opening the safeguarding case", () => {
  const sleep = async () => undefined;

  it("returns the case id on the first try", async () => {
    const open = vi.fn(async () => ({ caseId: "case-1" }));
    expect(await openCaseWithRetry(open, { sleep })).toEqual({ caseId: "case-1", attempts: 1 });
  });

  it("retries after a failure and reports each one", async () => {
    const onFailure = vi.fn();
    const open = vi.fn().mockRejectedValueOnce(new Error("db down")).mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ caseId: "case-2" });
    expect(await openCaseWithRetry(open, { sleep, onFailure })).toEqual({ caseId: "case-2", attempts: 3 });
    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it("never throws: after the last attempt it reports that no case was opened", async () => {
    const onFailure = vi.fn();
    const outcome = await openCaseWithRetry(async () => Promise.reject(new Error("still down")), { sleep, onFailure, attempts: 3 });
    expect(outcome.caseId).toBeNull();
    expect(outcome.attempts).toBe(3);
    expect(onFailure).toHaveBeenCalledTimes(3);
  });

  it("treats an empty case id as a failure", async () => {
    const outcome = await openCaseWithRetry(async () => ({ caseId: "" }), { sleep, attempts: 2 });
    expect(outcome.caseId).toBeNull();
  });
});
