// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { EN_GB } from "@/content/copy/en-GB";
import { getEnv, resetEnvCache } from "@/env";
import { needsSession, safeNextPath, signInRedirectPath } from "@/lib/protected-paths";
import { ANONYMOUS } from "@/server/authz";
import { fillCopy, tDefault } from "@/server/copy";
import { isAuthorisedCronRequest } from "@/server/jobs/cron-auth";
import { defineJob } from "@/server/jobs/define";
import { inngestFunctionId, inngestTriggers } from "@/server/jobs/inngest";
import { JOBS } from "@/server/jobs/registry";
import { METRIC_KEYS } from "@/server/metrics";
import { describeWait, hashIp, rateLimitKey, windowFor } from "@/server/ratelimit";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("proxy: which paths need a session", () => {
  it("covers learner, parent and studio areas", () => {
    for (const path of [
      "/home",
      "/explore",
      "/learn/course/step-1",
      "/portfolio",
      "/certificates",
      "/settings",
      "/onboarding",
      "/parent",
      "/parent/billing",
      "/studio",
      "/studio/review/1",
      "/STUDIO",
    ]) {
      expect(needsSession(path), path).toBe(true);
    }
  });

  it("lets public pages through", () => {
    for (const path of [
      "/",
      "/signin",
      "/signup",
      "/parents",
      "/courses",
      "/pricing",
      "/legal/privacy",
      "/verify/ABC",
      "/approve/token",
      "/join",
      "/help",
      "/homework",
    ]) {
      expect(needsSession(path), path).toBe(false);
    }
  });

  it("builds a sign-in address that remembers where the visitor was going", () => {
    expect(signInRedirectPath("/parent/billing", "?tab=plan")).toBe(
      "/signin?next=%2Fparent%2Fbilling%3Ftab%3Dplan",
    );
  });

  it("redirects a signed-out visitor to sign in, and lets everyone else through", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy, config } = await import("@/proxy");

    const signedOut = proxy(new NextRequest("http://localhost:3000/parent/billing?tab=plan"));
    expect(signedOut.status).toBe(307);
    expect(signedOut.headers.get("location")).toBe(
      "http://localhost:3000/signin?next=%2Fparent%2Fbilling%3Ftab%3Dplan",
    );

    // Any session cookie lets the request through: the page does the real check.
    const withCookie = proxy(
      new NextRequest("http://localhost:3000/studio", {
        headers: { cookie: "better-auth.session_token=anything.at-all" },
      }),
    );
    expect(withCookie.headers.get("location")).toBeNull();
    expect(withCookie.headers.get("x-middleware-next")).toBe("1");
    const secureCookie = proxy(
      new NextRequest("https://example.test/home", {
        headers: { cookie: "__Secure-better-auth.session_token=anything" },
      }),
    );
    expect(secureCookie.headers.get("location")).toBeNull();

    // Public pages pass through with no cookie.
    for (const path of ["/", "/signin", "/courses/build-an-app", "/parents"]) {
      expect(proxy(new NextRequest(`http://localhost:3000${path}`)).headers.get("location"), path).toBeNull();
    }

    // The matcher skips the API, Next.js internals and static files.
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const skipped of [
      "/api/health",
      "/api/auth/sign-in/email",
      "/_next/static/chunks/a.js",
      "/_next/image",
      "/favicon.ico",
      "/icons/icon-192.png",
      "/manifest.webmanifest",
      "/fonts/lexend.woff2",
    ]) {
      expect(matcher.test(skipped), skipped).toBe(false);
    }
    for (const matched of ["/", "/home", "/parent/billing", "/studio/review/123", "/learn/course/step"]) {
      expect(matcher.test(matched), matched).toBe(true);
    }
  });

  it("only ever returns to a path on this site", () => {
    expect(safeNextPath("/parent/billing?tab=plan")).toBe("/parent/billing?tab=plan");
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "",
      null,
      undefined,
      "/a\nb",
    ]) {
      expect(safeNextPath(bad, "/home")).toBe("/home");
    }
  });
});

describe("environment guards", () => {
  it("refuses STAFF_2FA_REQUIRED=false in production and preview", () => {
    for (const appEnv of ["production", "preview"]) {
      vi.stubEnv("APP_ENV", appEnv);
      vi.stubEnv("STAFF_2FA_REQUIRED", "false");
      vi.stubEnv("SEED_PASSWORD", undefined);
      vi.stubEnv("STRIPE_DRIVER", "stripe");
      vi.stubEnv("RADAR_FIXTURES", "false");
      resetEnvCache();
      expect(() => getEnv(), appEnv).toThrow(/STAFF_2FA_REQUIRED=false is only allowed/);
    }
  });

  it("allows it in local and test, and accepts production with two-factor on", () => {
    vi.stubEnv("STAFF_2FA_REQUIRED", "false");
    for (const appEnv of ["local", "test"]) {
      vi.stubEnv("APP_ENV", appEnv);
      resetEnvCache();
      expect(getEnv().STAFF_2FA_REQUIRED).toBe(false);
    }
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("STAFF_2FA_REQUIRED", "true");
    vi.stubEnv("SEED_PASSWORD", undefined);
    vi.stubEnv("STRIPE_DRIVER", "stripe");
    vi.stubEnv("RADAR_FIXTURES", "false");
    resetEnvCache();
    expect(getEnv().STAFF_2FA_REQUIRED).toBe(true);
  });
});

describe("cron secret", () => {
  it("accepts only the exact bearer token", () => {
    expect(isAuthorisedCronRequest("Bearer correct-horse-battery", "correct-horse-battery")).toBe(true);
    for (const header of [
      null,
      "",
      "correct-horse-battery",
      "Bearer ",
      "Bearer wrong",
      "Bearer correct-horse-battery ",
      "bearer correct-horse-battery",
      "Basic correct-horse-battery",
    ]) {
      expect(isAuthorisedCronRequest(header, "correct-horse-battery"), String(header)).toBe(false);
    }
  });
});

describe("rate limit helpers", () => {
  it("cuts time into fixed windows", () => {
    const { start, end } = windowFor(new Date("2026-11-16T12:00:42.500Z"), 60);
    expect(start.toISOString()).toBe("2026-11-16T12:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-16T12:01:00.000Z");
    expect(windowFor(new Date("2026-11-16T12:59:59Z"), 3600).start.toISOString()).toBe(
      "2026-11-16T12:00:00.000Z",
    );
  });

  it("says how long to wait in plain words", () => {
    expect(describeWait(1)).toBe("about 1 second");
    expect(describeWait(42.2)).toBe("about 43 seconds");
    expect(describeWait(60)).toBe("about 1 minute");
    expect(describeWait(200)).toBe("about 4 minutes");
    expect(describeWait(7200)).toBe("about 2 hours");
  });

  it("keys by user, then hashed IP, then a shared anonymous bucket", () => {
    const learner = {
      type: "learner",
      userId: "u-1",
      familyId: null,
      safetyBand: "teen_13_15",
      age: 14,
      status: "active",
    } as const;
    expect(rateLimitKey({ actor: learner, ip: "203.0.113.9" }, "coach.chat")).toBe("rl:coach.chat:user:u-1");
    const byIp = rateLimitKey({ actor: ANONYMOUS, ip: "203.0.113.9" }, "signup");
    expect(byIp).toMatch(/^rl:signup:ip:[\w-]{32}$/);
    expect(byIp).not.toContain("203.0.113.9");
    expect(rateLimitKey({ actor: ANONYMOUS }, "signup")).toBe("rl:signup:anonymous");
    expect(rateLimitKey({ actor: learner }, "coach.chat", "family:f-1")).toBe("rl:coach.chat:family:f-1");
    expect(hashIp("203.0.113.9")).toBe(hashIp(" 203.0.113.9 "));
    expect(hashIp("203.0.113.9")).not.toBe(hashIp("203.0.113.10"));
  });
});

describe("jobs", () => {
  it("validates job names, schedules and retries", () => {
    const run = async () => ({});
    expect(() => defineJob({ name: "Bad Name", run })).toThrow(/area\.verb/);
    expect(() => defineJob({ name: "nodots", run })).toThrow();
    expect(() => defineJob({ name: "a.b", schedule: "every day", run })).toThrow(/cron/);
    expect(() => defineJob({ name: "a.b", retries: 99, run })).toThrow(/retries/);
    expect(defineJob({ name: "retention.sweep", schedule: "15 3 * * *", run }).name).toBe("retention.sweep");
  });

  it("registers the kernel jobs with unique names", () => {
    const names = JOBS.map((j) => j.name);
    expect(names).toEqual(
      expect.arrayContaining(["notifications.release", "ratelimit.cleanup", "sessions.cleanup"]),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives Inngest UK-time cron triggers and event triggers", () => {
    expect(inngestTriggers({ schedule: "15 3 * * *" })).toEqual([{ cron: "TZ=Europe/London 15 3 * * *" }]);
    expect(inngestTriggers({ event: "export/requested" })).toEqual([{ event: "export/requested" }]);
    expect(inngestTriggers({ schedule: "*/10 * * * *", event: "notifications/release" })).toHaveLength(2);
    expect(inngestFunctionId("notifications.release")).toBe("notifications-release");
  });

  it("builds one Inngest function per registered job, and a serve handler for them", async () => {
    const { buildInngestFunctions, getInngest } = await import("@/server/jobs/inngest");
    const { serve } = await import("inngest/next");
    const functions = buildInngestFunctions();
    expect(functions).toHaveLength(JOBS.length);
    const handlers = serve({ client: getInngest(), functions });
    expect(typeof handlers.GET).toBe("function");
    expect(typeof handlers.POST).toBe("function");
    expect(typeof handlers.PUT).toBe("function");
  });
});

describe("copy defaults", () => {
  it("has the keys other teams need", () => {
    for (const key of [
      "error.generic",
      "unlock.ask_parent.title",
      "external.leaving.title",
      "ai.label",
      "submission.awaiting_review.title",
      "controls.paused.title",
      "controls.time_cap.title",
      "controls.quiet_hours.title",
      "signup.under13.body",
    ] as const) {
      expect(EN_GB[key].length, key).toBeGreaterThan(3);
    }
    expect(Object.keys(EN_GB).length).toBeGreaterThanOrEqual(40);
  });

  it("the under-13 message is kind and says nothing was kept", () => {
    expect(EN_GB["signup.under13.body"]).toMatch(/haven't saved anything/);
    expect(EN_GB["signup.under13.body"]).not.toMatch(/!|sorry, you are too young|blocked/i);
  });

  it("learner copy never mentions prices or exclamation-mark pile-ups", () => {
    for (const [key, value] of Object.entries(EN_GB)) {
      expect(value, key).not.toMatch(/£|\bprice\b|\bpay\b|checkout|!!/i);
    }
  });

  it("fills variables and leaves unknown ones empty", () => {
    expect(
      fillCopy("About {{minutes}} minutes left on {{ brandName }}{{nope}}.", {
        minutes: 5,
        brandName: "Makerly",
      }),
    ).toBe("About 5 minutes left on Makerly.");
    expect(tDefault("controls.time_cap.body", { minutes: 45 })).toContain("45 minutes");
  });
});

describe("metrics", () => {
  it("only has anonymous, fixed keys", () => {
    expect(METRIC_KEYS).toContain("signup.under13_blocked");
    for (const key of METRIC_KEYS) expect(key).toMatch(/^[a-z0-9_.]+$/);
  });
});
