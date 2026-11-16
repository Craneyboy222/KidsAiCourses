import { describe, expect, it } from "vitest";
import { isUrlAllowedForTool, toolViewForLearners, type ToolRow } from "@/server/services/tools";

const replit = { allowedUrlPrefixes: ["https://replit.com/"] };
const canva = { allowedUrlPrefixes: ["https://www.canva.com/", "https://canva.com/"] };
const scoped = { allowedUrlPrefixes: ["https://example.com/app"] };
const scopedSlash = { allowedUrlPrefixes: ["https://example.com/app/"] };

describe("isUrlAllowedForTool", () => {
  it.each([
    ["the official link", replit, "https://replit.com/"],
    ["the bare origin", replit, "https://replit.com"],
    ["a deep link with a path", replit, "https://replit.com/@team/starter-kit"],
    ["a deep link with a path and a query", replit, "https://replit.com/new?template=html&lang=en-GB"],
    ["a deep link with a fragment", replit, "https://replit.com/docs#privacy"],
    ["an upper-case host", replit, "https://REPLIT.com/new"],
    ["the default port written out", replit, "https://replit.com:443/new"],
    ["a second allowed prefix", canva, "https://canva.com/design"],
    ["a path prefix, exactly", scoped, "https://example.com/app"],
    ["a path under a path prefix", scoped, "https://example.com/app/projects/1"],
    ["a path under a path prefix that ends with a slash", scopedSlash, "https://example.com/app/projects"],
  ])("allows %s", (_name, tool, url) => {
    expect(isUrlAllowedForTool(tool, url)).toBe(true);
  });

  it.each([
    ["http", replit, "http://replit.com/"],
    ["a lookalike host that starts with the prefix", replit, "https://replit.com.evil.example/"],
    ["a lookalike host without a slash", replit, "https://replit.com.evil.example"],
    ["a lookalike with a hyphen", replit, "https://replit.com-login.example/"],
    ["userinfo that looks like the host", replit, "https://replit.com@evil.example/"],
    ["userinfo with a password", replit, "https://user:pass@replit.com/"],
    ["a username on the real host", replit, "https://learner@replit.com/"],
    ["another host", replit, "https://evil.example/"],
    ["the real address hidden in a path", replit, "https://evil.example/https://replit.com/"],
    ["the real address hidden in a query", replit, "https://evil.example/?next=https://replit.com/"],
    ["a subdomain that is not listed", replit, "https://docs.replit.com/"],
    ["a parent domain", canva, "https://com/"],
    ["www when only the bare host is listed", replit, "https://www.replit.com/"],
    ["another port", replit, "https://replit.com:8443/"],
    ["a trailing dot on the host", replit, "https://replit.com./"],
    ["a backslash trick", replit, "https://replit.com\\@evil.example/"],
    ["a backslash before the host", replit, "https:\\\\evil.example/"],
    ["a protocol-relative address", replit, "//replit.com/"],
    ["a relative path", replit, "/new"],
    ["javascript:", replit, "javascript:alert(1)//https://replit.com/"],
    ["data:", replit, "data:text/html,https://replit.com/"],
    ["leading whitespace", replit, " https://replit.com/"],
    ["a newline inside", replit, "https://replit.com/\nhttps://evil.example"],
    ["a tab inside the scheme", replit, "ht\ttps://replit.com/"],
    ["an empty string", replit, ""],
    ["not a URL", replit, "replit.com"],
    ["a sibling path that only shares the prefix text", scoped, "https://example.com/apple"],
    ["a path outside the path prefix", scoped, "https://example.com/other"],
    ["path traversal out of the path prefix", scoped, "https://example.com/app/../admin"],
    ["encoded path traversal out of the path prefix", scoped, "https://example.com/app/%2e%2e/admin"],
    ["the prefix path without its slash", scopedSlash, "https://example.com/app"],
    ["a password in the query", replit, "https://replit.com/login?password=hunter2"],
    ["an API key in the query", replit, "https://replit.com/new?api_key=abc"],
    ["a token in the query", replit, "https://replit.com/new?access_token=abc"],
    ["a one-time code in the query", replit, "https://replit.com/verify?otp=123456"],
  ])("rejects %s", (_name, tool, url) => {
    expect(isUrlAllowedForTool(tool, url)).toBe(false);
  });

  it("rejects everything when the tool has no prefixes", () => {
    expect(isUrlAllowedForTool({ allowedUrlPrefixes: [] }, "https://replit.com/")).toBe(false);
  });

  it("ignores a stored prefix that is not a plain https address", () => {
    expect(isUrlAllowedForTool({ allowedUrlPrefixes: ["http://replit.com/"] }, "http://replit.com/")).toBe(
      false,
    );
    expect(
      isUrlAllowedForTool({ allowedUrlPrefixes: ["https://a@replit.com/"] }, "https://replit.com/"),
    ).toBe(false);
    expect(
      isUrlAllowedForTool(
        { allowedUrlPrefixes: ["not a url", "https://replit.com/"] },
        "https://replit.com/x",
      ),
    ).toBe(true);
  });

  it("handles an internationalised host by its ASCII form only", () => {
    // A Cyrillic "е" in "rеplit" is a different host, however alike it looks.
    expect(isUrlAllowedForTool(replit, "https://rеplit.com/")).toBe(false);
  });
});

function row(overrides: Partial<ToolRow> = {}): ToolRow {
  const now = new Date("2026-11-15T10:00:00Z");
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "replit",
    name: "Replit",
    vendorDomain: "replit.com",
    officialUrl: "https://replit.com/",
    allowedUrlPrefixes: ["https://replit.com/"],
    cost: "Fixture cost note",
    freeTier: "Fixture free tier",
    minAge: 13,
    consentRule: null,
    under18Policy: "allowed",
    parentOperatedAllowedRecordedBy: null,
    parentOperatedAllowedRecordedAt: null,
    notes: "Internal note that learners must not see",
    status: "approved",
    lastCheckedAt: now,
    verifiedBy: "00000000-0000-4000-8000-000000000002",
    verifiedAt: now,
    evidence: [{ claim: "internal", url: "https://replit.com/terms" }],
    watchPages: [],
    sourceCandidateId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("toolViewForLearners", () => {
  it("shows the display facts of an approved tool and nothing internal", () => {
    const view = toolViewForLearners(row(), { guideHref: "/courses/snaplab/guides/guide-replit" });
    expect(view).toEqual({
      slug: "replit",
      name: "Replit",
      officialUrl: "https://replit.com/",
      cost: "Fixture cost note",
      freeTier: "Fixture free tier",
      minAge: 13,
      under18Policy: "allowed",
      parentMustApprove: false,
      parentMustSetUp: false,
      guideHref: "/courses/snaplab/guides/guide-replit",
      lastCheckedAt: new Date("2026-11-15T10:00:00Z"),
    });
    expect(JSON.stringify(view)).not.toMatch(/Internal note|evidence|verifiedBy/);
  });

  it.each(["candidate", "pending_verification", "blocked", "retired"] as const)(
    "returns nothing for a %s tool",
    (status) => {
      expect(toolViewForLearners(row({ status }))).toBeNull();
    },
  );

  it("returns nothing when the policy is unset or blocked", () => {
    expect(toolViewForLearners(row({ under18Policy: null }))).toBeNull();
    expect(toolViewForLearners(row({ under18Policy: "blocked" }))).toBeNull();
  });

  it("says when a parent must approve, and when a parent must set the account up", () => {
    const consent = toolViewForLearners(row({ under18Policy: "parent_consent_required" }));
    expect(consent).toMatchObject({ parentMustApprove: true, parentMustSetUp: false, guideHref: null });
    const operated = toolViewForLearners(row({ under18Policy: "parent_operated", minAge: 18 }));
    expect(operated).toMatchObject({ parentMustApprove: true, parentMustSetUp: true, minAge: 18 });
  });

  it("never passes on an official link that fails the tool's own allow-list", () => {
    expect(
      toolViewForLearners(row({ officialUrl: "https://replit.com.evil.example/" }))?.officialUrl,
    ).toBeNull();
    expect(toolViewForLearners(row({ officialUrl: null }))?.officialUrl).toBeNull();
  });
});
