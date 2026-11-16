import { describe, expect, it } from "vitest";
import type { LearnerActor } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { createMemoryCoachDeps } from "@/server/ai/memory-deps";
import { COACH_COPY, COACH_STAGES, chunkForStreaming, createCoachProxy, type CoachDeps } from "@/server/ai/proxy";
import { sseFrames, toMetaEvent } from "@/server/ai/wire";

const learner: LearnerActor = { type: "learner", userId: "learner-fixture", familyId: "family-fixture", safetyBand: "teen_13_15", age: 14, status: "active" };
const ctx: Ctx = { db: undefined as never, actor: learner, now: new Date("2026-11-16T10:00:00Z"), requestId: "unit-test", ip: "203.0.113.9" };
const request = { courseSlug: "build-your-own-snapchat-style-app", stepKey: "s5", message: "the filter does nothing" };
const boom = async (): Promise<never> => {
  throw new Error("service down");
};

describe("the pipeline fails closed", () => {
  it("has the eleven stages of spec Section 8, in order", () => {
    expect(COACH_STAGES).toEqual([
      "authn_authz",
      "capability",
      "rate_limits",
      "credit_reservation",
      "input_sanitisation",
      "input_moderation",
      "prompt_assembly",
      "model_call",
      "output_moderation",
      "commit_and_record",
      "return",
    ]);
  });

  const breakers: Array<[string, (deps: CoachDeps) => void]> = [
    ["the learning-allowed check", (d) => (d.people.learningAllowed = boom)],
    ["the age-assurance check", (d) => (d.people.ageAssured = boom)],
    ["the consent check", (d) => (d.people.hasConsent = boom)],
    ["settings", (d) => (d.settings = boom)],
    ["the step lookup", (d) => (d.course.resolveStep = boom)],
    ["the rate limiter", (d) => (d.rateLimit.hit = boom)],
    ["the concurrency cap", (d) => (d.rateLimit.acquire = boom)],
    ["the entitlement lookup", (d) => (d.people.entitlement = boom)],
    ["the credit reservation", (d) => (d.credits.reserve = boom)],
    ["input moderation", (d) => (d.moderator = { name: "broken", moderate: boom })],
  ];
  it.each(breakers)("when %s throws, the learner gets a safe message and no model is called", async (_name, breakIt) => {
    const { deps, state } = createMemoryCoachDeps();
    breakIt(deps);
    const result = await createCoachProxy(deps).chat(ctx, request);
    expect(result.kind).toBe("denied");
    expect(result.code).toBe("ai_unavailable");
    expect(result.outcome).toBe("error");
    expect(result.message).toBe(COACH_COPY.unavailable);
    expect(result.aiGenerated).toBe(false);
    expect(state.modelCalls).toBe(0);
    expect(state.charged).toBe(0);
    expect(state.reserved.size).toBe(0);
    expect(state.logs.some((log) => log.event === "coach.stage_failed")).toBe(true);
  });

  it("when the model call throws, nothing is shown or charged and the hold is released", async () => {
    const { deps, state } = createMemoryCoachDeps();
    deps.gateway.generate = boom;
    const result = await createCoachProxy(deps).chat(ctx, request);
    expect(result).toMatchObject({ kind: "denied", code: "ai_unavailable" });
    expect(state.charged).toBe(0);
    expect(state.balance).toBe(50);
  });

  it("when output moderation throws, the unmoderated model text is never returned", async () => {
    const { deps, state } = createMemoryCoachDeps({ recordedOutputs: ["SECRET-MODEL-TEXT"] });
    let calls = 0;
    deps.moderator = {
      name: "flaky",
      moderate: async (input) => {
        calls += 1;
        if (input.direction === "output") throw new Error("moderation down");
        return { action: "allow", category: null, findings: [], crisis: null, safeguarding: null, message: null, summary: {}, moderator: "flaky" };
      },
    };
    const result = await createCoachProxy(deps).chat(ctx, request);
    expect(calls).toBe(2);
    expect(result.kind).toBe("denied");
    expect(result.message).not.toContain("SECRET-MODEL-TEXT");
    expect(state.charged).toBe(0);
  });

  it("when the reply cannot be recorded, it is not shown and not charged", async () => {
    const { deps, state } = createMemoryCoachDeps();
    deps.store.record = boom;
    const result = await createCoachProxy(deps).chat(ctx, request);
    expect(result.kind).toBe("denied");
    expect(result.requestId).toBeNull();
    expect(state.modelCalls).toBe(1);
  });

  it("a disclosure still gets the script when a safety stage is down", async () => {
    const { deps, state } = createMemoryCoachDeps();
    deps.moderator = { name: "broken", moderate: boom };
    deps.people.entitlement = boom;
    const result = await createCoachProxy(deps).chat(ctx, { ...request, message: "i want to kill myself" });
    await result.settled;
    expect(result.kind).toBe("crisis");
    expect(result.message).toContain("0800 1111");
    expect(state.modelCalls).toBe(0);
    expect(state.cases).toHaveLength(1);
  });

  it("a disclosure gets the script even if recording it fails", async () => {
    const { deps, state } = createMemoryCoachDeps();
    deps.store.record = boom;
    const result = await createCoachProxy(deps).chat(ctx, { ...request, message: "my dad hits me" });
    await result.settled;
    expect(result.kind).toBe("crisis");
    expect(result.crisis?.contacts.map((c) => c.display)).toContain("0800 1111");
    expect(state.cases).toHaveLength(1);
  });

  it("only the tutor feature is allowed", async () => {
    const { deps, state } = createMemoryCoachDeps();
    const result = await createCoachProxy(deps).chat(ctx, { ...request, feature: "draft_course" });
    expect(result).toMatchObject({ kind: "denied", code: "forbidden" });
    expect(state.modelCalls).toBe(0);
  });
});

describe("what goes over the wire", () => {
  it("streams approved text in order, with meta first and done last", async () => {
    const { deps } = createMemoryCoachDeps();
    const result = await createCoachProxy(deps).chat(ctx, request);
    const frames = sseFrames(result);
    expect(frames[0]).toMatch(/^event: meta\n/);
    expect(frames.at(-1)).toMatch(/^event: done\n/);
    const text = frames
      .filter((f) => f.startsWith("event: delta"))
      .map((f) => (JSON.parse(f.split("\ndata: ")[1] ?? "{}") as { text: string }).text)
      .join("");
    expect(text).toBe(result.message);
    expect(toMetaEvent(result)).toMatchObject({ kind: "reply", aiGenerated: true, label: "AI-generated" });
  });

  it("chunkForStreaming keeps words whole and loses nothing", () => {
    const text = "Read the error message slowly, right to the end. It usually names a line.";
    const chunks = chunkForStreaming(text, 20);
    expect(chunks.join("")).toBe(text);
    expect(chunks.length).toBeGreaterThan(2);
  });
});
