import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { RETENTION_DEFAULTS, policyDescription } from "@/server/services/retention";
import { notImplemented } from "@/server/services/_contract";
import { placeholderCaptions, placeholderTranscript, singleFileZip } from "../../../scripts/make-placeholder-assets";
import { SEED_TOTP_SECRET, assertSeedAllowed, formatSeedResult, notBuiltName } from "../../../scripts/seed";

describe("the seed refuses anything but local development and tests", () => {
  it.each(["production", "preview", "staging", ""])("refuses APP_ENV=%j", (appEnv) => {
    expect(() => assertSeedAllowed(appEnv, "development")).toThrow(AppError);
    expect(() => assertSeedAllowed(appEnv, "development")).toThrow(/refuses to run/);
  });

  it("refuses a production build even when APP_ENV says local", () => {
    expect(() => assertSeedAllowed("local", "production")).toThrow(/refuses to run/);
  });

  it.each(["local", "test"])("allows APP_ENV=%s", (appEnv) => {
    expect(() => assertSeedAllowed(appEnv, "development")).not.toThrow();
  });
});

describe("a slice that is not built yet is a skip, not a failure", () => {
  it("recognises the error a contract placeholder throws", () => {
    let thrown: unknown;
    try {
      notImplemented("safeguarding.openSafeguardingCase");
    } catch (error) {
      thrown = error;
    }
    expect(notBuiltName(thrown)).toBe("safeguarding.openSafeguardingCase");
  });

  it("does not mistake any other error for a skip", () => {
    expect(notBuiltName(new AppError("internal", "Something else went wrong."))).toBeNull();
    expect(notBuiltName(new Error("boom"))).toBeNull();
    expect(notBuiltName("nope")).toBeNull();
  });
});

describe("the account table", () => {
  const text = formatSeedResult({
    database: "platform_dev",
    accounts: [{ who: "Owner", signIn: "owner@example.test", kind: "staff: super_admin", notes: "two-step code needed" }],
    skipped: ["the TEST safeguarding case (safeguarding.openSafeguardingCase)"],
    problems: [],
    signupOpen: true,
    totp: { secret: SEED_TOTP_SECRET, uri: "otpauth://totp/x" },
  });

  it("names the password variable and never prints a password", () => {
    expect(text).toContain("SEED_PASSWORD");
    expect(text).not.toMatch(/Local-Dev-Pass|password is /i);
  });

  it("prints the local two-step secret and what was skipped", () => {
    expect(text).toContain(SEED_TOTP_SECRET);
    expect(text).toContain("LOCAL ONLY");
    expect(text).toContain("the TEST safeguarding case");
  });
});

describe("retention defaults (spec Section 9)", () => {
  const days = Object.fromEntries(RETENTION_DEFAULTS.map((policy) => [policy.key, policy.days]));

  it("carries the spec's periods", () => {
    expect(days).toMatchObject({
      tutor_conversation_default: 30,
      tutor_conversation_extended: 90,
      pending_teen: 7,
      account_deletion_undo: 14,
      account_inactive: 730,
      account_inactive_warning: 30,
      ai_metadata: 395,
      flagged_content: 365,
      billing_records: 2190,
      audit_log: 730,
      rejected_upload: 0,
    });
  });

  it("has no duplicate keys", () => {
    expect(new Set(RETENTION_DEFAULTS.map((policy) => policy.key)).size).toBe(RETENTION_DEFAULTS.length);
  });

  it("marks every period the law decides with the scales", () => {
    for (const key of ["safeguarding_case", "consent_record", "billing_records", "audit_log", "flagged_content", "account_inactive"]) {
      const policy = RETENTION_DEFAULTS.find((candidate) => candidate.key === key);
      expect(policy?.legal, key).toBe(true);
      expect(policy ? policyDescription(policy) : "").toMatch(/^⚖️ /);
    }
    const plain = RETENTION_DEFAULTS.find((candidate) => candidate.key === "job_run_log");
    expect(plain ? policyDescription(plain) : "⚖️").not.toContain("⚖️");
  });
});

describe("placeholder text files", () => {
  it("writes captions as WebVTT with cues inside the clip", () => {
    const vtt = placeholderCaptions("Prompt Gym");
    expect(vtt.startsWith("WEBVTT\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:03.000");
    expect(vtt).toContain("Prompt Gym");
  });

  it("says plainly in the transcript that it is a placeholder", () => {
    expect(placeholderTranscript("Prompt Gym")).toMatch(/PLACEHOLDER/);
  });

  it("builds a zip a zip reader accepts: one stored file and an end record", () => {
    const zip = singleFileZip("template.md", Buffer.from("hello"));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(1);
    expect(zip.includes(Buffer.from("template.md"))).toBe(true);
    expect(zip.includes(Buffer.from("hello"))).toBe(true);
  });
});
