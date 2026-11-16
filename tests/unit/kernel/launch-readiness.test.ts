// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REQUIRED_LEGAL_SLUGS,
  evaluateLaunchReadiness,
  type ReadinessInputs,
} from "@/server/settings/launch-readiness";
import { LAUNCH_READINESS_ITEMS } from "@/server/settings/registry";

const confirmed = { confirmedBy: "owner-id", confirmedAt: "2026-11-16T10:00:00.000Z", note: "Signed off" };

function ready(overrides: Partial<ReadinessInputs> = {}): ReadinessInputs {
  return {
    dslName: "Chris Owner",
    aiProviderMode: "fixture",
    processors: [],
    requiredProcessorKeys: [],
    publishedLegalSlugs: [...REQUIRED_LEGAL_SLUGS],
    publishedCourseTools: [{ slug: "replit", status: "approved", under18Policy: "parent_consent_required" }],
    confirmations: {
      crisis_scripts_approved: confirmed,
      age_assurance_confirmed: confirmed,
      dpia_signed_off: confirmed,
      osa_assessed: confirmed,
    },
    ...overrides,
  };
}

const item = (inputs: ReadinessInputs, key: string) => {
  const found = evaluateLaunchReadiness(inputs).items.find((i) => i.key === key);
  if (!found) throw new Error(`no item ${key}`);
  return found;
};

describe("evaluateLaunchReadiness", () => {
  it("passes when everything is in place, and returns every item in registry order", () => {
    const result = evaluateLaunchReadiness(ready());
    expect(result.ready).toBe(true);
    expect(result.outstanding).toEqual([]);
    expect(result.items.map((i) => i.key)).toEqual(LAUNCH_READINESS_ITEMS.map((i) => i.key));
    for (const i of result.items) expect(i.detail.length).toBeGreaterThan(0);
  });

  it("fails closed when nothing has been done", () => {
    const result = evaluateLaunchReadiness({
      dslName: null,
      aiProviderMode: "fixture",
      processors: [],
      requiredProcessorKeys: [],
      publishedLegalSlugs: [],
      publishedCourseTools: [],
      confirmations: {},
    });
    expect(result.ready).toBe(false);
    expect(result.outstanding.map((i) => i.key).sort()).toEqual(
      [
        "age_assurance_confirmed",
        "crisis_scripts_approved",
        "dpia_signed_off",
        "dsl_named",
        "legal_pages_published",
        "osa_assessed",
      ].sort(),
    );
  });

  it("dsl_named needs a name that is not just spaces", () => {
    expect(item(ready({ dslName: "   " }), "dsl_named").satisfied).toBe(false);
    expect(item(ready({ dslName: null }), "dsl_named").satisfied).toBe(false);
    expect(item(ready(), "dsl_named")).toMatchObject({ satisfied: true, auto: true });
  });

  it("processors_approved fails for an enabled processor with no approval or no DPA", () => {
    const approvedAt = new Date("2026-11-01T00:00:00Z");
    expect(
      item(
        ready({
          processors: [{ providerKey: "acme", enabled: true, approvedAt: null, dpaReference: "DPA-1" }],
        }),
        "processors_approved",
      ).satisfied,
    ).toBe(false);
    const noDpa = item(
      ready({ processors: [{ providerKey: "acme", enabled: true, approvedAt, dpaReference: " " }] }),
      "processors_approved",
    );
    expect(noDpa.satisfied).toBe(false);
    expect(noDpa.detail).toContain("acme");
    // A disabled, unapproved row is fine: it cannot be used.
    expect(
      item(
        ready({
          processors: [{ providerKey: "acme", enabled: false, approvedAt: null, dpaReference: null }],
        }),
        "processors_approved",
      ).satisfied,
    ).toBe(true);
    expect(
      item(
        ready({ processors: [{ providerKey: "acme", enabled: true, approvedAt, dpaReference: "DPA-1" }] }),
        "processors_approved",
      ).satisfied,
    ).toBe(true);
  });

  it("processors_approved needs at least one enabled model provider when AI is live", () => {
    const approvedAt = new Date("2026-11-01T00:00:00Z");
    expect(item(ready({ aiProviderMode: "gateway" }), "processors_approved").satisfied).toBe(false);
    expect(
      item(
        ready({
          aiProviderMode: "gateway",
          processors: [{ providerKey: "acme", enabled: false, approvedAt, dpaReference: "DPA-1" }],
        }),
        "processors_approved",
      ).satisfied,
    ).toBe(false);
    expect(
      item(
        ready({
          aiProviderMode: "gateway",
          processors: [{ providerKey: "acme", enabled: true, approvedAt, dpaReference: "DPA-1" }],
        }),
        "processors_approved",
      ).satisfied,
    ).toBe(true);
    // An approved email provider is not a model provider.
    const onlyEmail = ready({
      aiProviderMode: "gateway",
      requiredProcessorKeys: ["email.resend"],
      processors: [{ providerKey: "email.resend", enabled: true, approvedAt, dpaReference: "DPA-2" }],
    });
    expect(item(onlyEmail, "processors_approved").satisfied).toBe(false);
  });

  it("processors_approved needs the configured email and storage providers to be approved and enabled", () => {
    const missing = item(
      ready({ requiredProcessorKeys: ["email.resend", "storage.s3"] }),
      "processors_approved",
    );
    expect(missing.satisfied).toBe(false);
    expect(missing.detail).toContain("email.resend");
    expect(missing.detail).toContain("storage.s3");
  });

  it("legal_pages_published names the pages that are missing", () => {
    const result = item(
      ready({ publishedLegalSlugs: ["privacy", "terms", "cookies"] }),
      "legal_pages_published",
    );
    expect(result.satisfied).toBe(false);
    expect(result.detail).toContain("privacy-teen");
    expect(result.detail).toContain("community-code");
    expect(result.detail).toContain("ai-use-policy");
    expect(result.detail).not.toContain("terms");
  });

  it("tools_verified needs every tool to be approved with an under-18 policy", () => {
    expect(item(ready({ publishedCourseTools: [] }), "tools_verified").satisfied).toBe(true);
    const pending = item(
      ready({
        publishedCourseTools: [{ slug: "newtool", status: "pending_verification", under18Policy: "allowed" }],
      }),
      "tools_verified",
    );
    expect(pending.satisfied).toBe(false);
    expect(pending.detail).toContain("newtool");
    expect(
      item(
        ready({ publishedCourseTools: [{ slug: "replit", status: "approved", under18Policy: null }] }),
        "tools_verified",
      ).satisfied,
    ).toBe(false);
  });

  it("manual items are satisfied only by a confirmation, and report who and when", () => {
    const withOne = ready({ confirmations: { crisis_scripts_approved: confirmed } });
    expect(item(withOne, "crisis_scripts_approved")).toMatchObject({
      auto: false,
      satisfied: true,
      confirmedBy: "owner-id",
      confirmedAt: confirmed.confirmedAt,
      detail: "Signed off",
    });
    expect(item(withOne, "dpia_signed_off")).toMatchObject({ auto: false, satisfied: false });
    expect(item(withOne, "dpia_signed_off").confirmedBy).toBeUndefined();
  });

  it("a confirmation recorded against an automatic item does not satisfy it", () => {
    expect(
      item(
        ready({ dslName: null, confirmations: { ...ready().confirmations, dsl_named: confirmed } }),
        "dsl_named",
      ).satisfied,
    ).toBe(false);
  });
});
