/**
 * Stage 8 on real Postgres: the model call through the gateway (spec Section 8, decision D1).
 *
 * `model_route` maps an alias to an ordered list of providers. A provider is only ever called if
 * it is approved as a processor with a DPA on record AND switched on (`assertProcessorEnabled`),
 * and so is the gateway that carries the call. Costs are whole millipence. `fixture` mode needs
 * none of that and touches no network.
 *
 * No test here reaches a provider: in `gateway` mode the "provider" is the fixture model handed
 * back by `resolveModel`. `usage`, `entitlements` and `safeguarding` are mocked for the two
 * pipeline tests (their contract bodies are not written yet).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultModelGateway, loadModelRoutes } from "@/server/ai/deps";
import { createFixtureModel, type FixtureScript, type FixtureTurn } from "@/server/ai/fixture-model";
import { COACH_ROUTE_ALIAS, GATEWAY_PROCESSOR_KEY, MODEL_TIMEOUT_MS, createModelGateway, type ModelRoute } from "@/server/ai/gateway";
import { COACH_COPY, type ModelGateway } from "@/server/ai/proxy";
import { modelRoute, spendCounter } from "@/server/db";
import { AppError } from "@/server/errors";
import { approveProcessor, assertProcessorEnabled, setProcessorEnabled } from "@/server/processors";
import { db } from "../../helpers/db";
import { aiRequestsFor, ask, balanceFor, coachCtx, createCoachLearner, harness, ledgerFor, messagesFor, resetBetweenTests, setUpWorld, type World } from "./helpers";

vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<object>()), getEntitlementForLearner: vi.fn() }));
vi.mock("@/server/services/usage", async (original) => ({ ...(await original<object>()), checkLearningAllowed: vi.fn() }));
vi.mock("@/server/services/safeguarding", async (original) => ({ ...(await original<object>()), openSafeguardingCase: vi.fn() }));

const REQUEST = { alias: COACH_ROUTE_ALIAS, instructions: "Step title: Filters\nHint ladder rung for this turn: 2 of 5", messages: [{ role: "user" as const, content: "the filter does nothing" }], maxOutputTokens: 400 };

let world: World;
beforeAll(async () => {
  world = await setUpWorld();
});
beforeEach(async () => {
  await resetBetweenTests();
  await db.delete(modelRoute);
  await db.execute("DELETE FROM ai_processor");
});

async function processor(providerKey: string, state: "enabled" | "approved_only"): Promise<void> {
  const ctx = coachCtx(world.owner);
  await approveProcessor(ctx, { providerKey, name: providerKey, purpose: "Coach replies (test)", region: "UK (London)", dpaReference: `DPA-${providerKey}` });
  if (state === "enabled") await setProcessorEnabled(ctx, providerKey, true, "test");
}

async function route(values: { priority: number; providerKey: string; model: string; input?: number; output?: number; params?: Record<string, unknown>; enabled?: boolean }): Promise<void> {
  await db.insert(modelRoute).values({
    alias: COACH_ROUTE_ALIAS,
    priority: values.priority,
    providerKey: values.providerKey,
    model: values.model,
    enabled: values.enabled ?? true,
    params: values.params ?? {},
    inputPencePerMillionTokens: values.input ?? 0,
    outputPencePerMillionTokens: values.output ?? 0,
  });
}

/** A gateway in `gateway` mode on the real routes and processor checks, with fixture models as the "providers". */
function liveGateway(options: { script?: (route: ModelRoute) => FixtureScript; timeoutMs?: number } = {}): { gateway: ModelGateway; resolved: string[]; turns: FixtureTurn[]; warnings: string[] } {
  const resolved: string[] = [];
  const turns: FixtureTurn[] = [];
  const warnings: string[] = [];
  const gateway = createModelGateway({
    mode: "gateway",
    loadRoutes: loadModelRoutes,
    assertProcessorApproved: assertProcessorEnabled,
    resolveModel: (chosen) => {
      resolved.push(chosen.model);
      const script = options.script?.(chosen);
      return createFixtureModel(async (turn) => {
        turns.push(turn);
        return script?.(turn);
      });
    },
    timeoutMs: options.timeoutMs,
    warn: (event) => void warnings.push(event),
  });
  return { gateway, resolved, turns, warnings };
}

describe("fixture mode (AI_PROVIDER_MODE=fixture, the default)", () => {
  it("answers from the built-in deterministic model with no route, no approval, no network and no cost", async () => {
    const ctx = coachCtx(world.owner);
    const gateway = defaultModelGateway();
    const first = await gateway.generate(ctx, REQUEST);
    const second = await gateway.generate(ctx, REQUEST);
    expect(first.text).toBe(second.text);
    expect(first.text).toMatch(/^Here's a nudge\./);
    expect(first).toMatchObject({ providerKey: "fixture", model: "fixture-coach-1", routeAlias: COACH_ROUTE_ALIAS, costMillipence: 0 });
    expect(first.inputTokens).toBeGreaterThan(0);
    expect(first.outputTokens).toBeGreaterThan(0);
    expect(await gateway.prices(ctx, COACH_ROUTE_ALIAS)).toEqual({ inputPencePerMillionTokens: 0, outputPencePerMillionTokens: 0 });
  });
});

describe("gateway mode: alias → provider through model_route", () => {
  it("has a 30-second timeout", () => {
    expect(MODEL_TIMEOUT_MS).toBe(30_000);
  });

  it("refuses when the alias has no enabled route", async () => {
    await processor(GATEWAY_PROCESSOR_KEY, "enabled");
    await processor("provider-a", "enabled");
    await route({ priority: 0, providerKey: "provider-a", model: "a/small", enabled: false });
    const { gateway, resolved } = liveGateway();
    await expect(gateway.generate(coachCtx(world.owner), REQUEST)).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(resolved).toHaveLength(0);
  });

  it("calls nothing while the gateway itself is not an approved, enabled processor", async () => {
    await processor("provider-a", "enabled");
    await route({ priority: 0, providerKey: "provider-a", model: "a/small" });
    const { gateway, resolved } = liveGateway();
    await expect(gateway.generate(coachCtx(world.owner), REQUEST)).rejects.toBeInstanceOf(AppError);
    expect(resolved).toHaveLength(0);

    await processor(GATEWAY_PROCESSOR_KEY, "approved_only");
    await expect(gateway.generate(coachCtx(world.owner), REQUEST)).rejects.toBeInstanceOf(AppError);
    expect(resolved).toHaveLength(0);
  });

  it("never calls a provider that is approved but not switched on; with no other route it fails closed", async () => {
    await processor(GATEWAY_PROCESSOR_KEY, "enabled");
    await processor("provider-a", "approved_only");
    await route({ priority: 0, providerKey: "provider-a", model: "a/small" });
    const { gateway, resolved, warnings } = liveGateway();
    await expect(gateway.generate(coachCtx(world.owner), REQUEST)).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(resolved).toHaveLength(0);
    expect(warnings).toEqual(["ai.gateway.route_not_approved"]);
  });

  it("uses the first approved route, pins the call to that provider, asks for zero retention and no training, and prices it in millipence", async () => {
    await processor(GATEWAY_PROCESSOR_KEY, "enabled");
    await processor("provider-a", "enabled");
    await processor("provider-b", "enabled");
    await route({ priority: 0, providerKey: "provider-a", model: "a/small", input: 250, output: 1000, params: { temperature: 0.2, maxOutputTokens: 300 } });
    await route({ priority: 1, providerKey: "provider-b", model: "b/large", input: 900, output: 3000 });
    const { gateway, resolved, turns } = liveGateway();
    const result = await gateway.generate(coachCtx(world.owner), REQUEST);

    expect(resolved).toEqual(["a/small"]);
    expect(result).toMatchObject({ providerKey: "provider-a", model: "a/small", routeAlias: COACH_ROUTE_ALIAS });
    // Cost = tokens × pence per million, in millipence, rounded up.
    const exact = ((result.inputTokens * 250 + result.outputTokens * 1000) / 1_000_000) * 1000;
    expect(result.costMillipence).toBe(Math.ceil(Number(exact.toFixed(6))));
    expect(result.costMillipence).toBeGreaterThan(0);
    expect(Number.isInteger(result.costMillipence)).toBe(true);

    expect(turns[0]?.call).toMatchObject({ temperature: 0.2, maxOutputTokens: 300, providerOptions: { gateway: { zeroDataRetention: true, disallowPromptTraining: true, only: ["provider-a"] } } });
    expect(turns[0]?.instructions).toBe(REQUEST.instructions);
    expect(turns[0]?.lastUserMessage).toBe("the filter does nothing");
    // The estimate is priced against the dearest route, so a fallback can never cost more than was held.
    expect(await gateway.prices(coachCtx(world.owner), COACH_ROUTE_ALIAS)).toEqual({ inputPencePerMillionTokens: 900, outputPencePerMillionTokens: 3000 });
  });

  it("falls back to the next route when the first fails, and skips an unapproved one on the way", async () => {
    await processor(GATEWAY_PROCESSOR_KEY, "enabled");
    await processor("provider-a", "enabled");
    await processor("provider-b", "approved_only");
    await processor("provider-c", "enabled");
    await route({ priority: 0, providerKey: "provider-a", model: "a/small", output: 1000 });
    await route({ priority: 1, providerKey: "provider-b", model: "b/large", output: 3000 });
    await route({ priority: 2, providerKey: "provider-c", model: "c/medium", output: 2000 });
    const { gateway, resolved, warnings } = liveGateway({
      script: (chosen) => async () => {
        if (chosen.model === "a/small") throw new Error("the learner's prompt was: SECRET");
        return "What have you tried so far?";
      },
    });
    const result = await gateway.generate(coachCtx(world.owner), REQUEST);
    expect(result).toMatchObject({ providerKey: "provider-c", model: "c/medium", text: "What have you tried so far?" });
    expect(resolved).toEqual(["a/small", "c/medium"]);
    expect(warnings).toEqual(["ai.gateway.route_failed", "ai.gateway.route_not_approved"]);
  });

  it("gives up on a provider that does not answer in time", async () => {
    await processor(GATEWAY_PROCESSOR_KEY, "enabled");
    await processor("provider-a", "enabled");
    await route({ priority: 0, providerKey: "provider-a", model: "a/slow" });
    const { gateway, resolved } = liveGateway({
      timeoutMs: 80,
      script: () => (turn) =>
        new Promise<string | undefined>((_resolve, reject) => {
          // A provider that never answers; it stops only when the gateway's timeout aborts the call.
          turn.call?.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    const started = Date.now();
    await expect(gateway.generate(coachCtx(world.owner), REQUEST)).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(resolved).toEqual(["a/slow"]);
  });
});

describe("the pipeline on a priced route", () => {
  it("holds enough for the dearest route, charges cost × margin ÷ credit value, and adds the cost to the day's spend", async () => {
    await processor(GATEWAY_PROCESSOR_KEY, "enabled");
    await processor("provider-a", "enabled");
    // Dear enough that one reply costs several credits, cheap enough that the worst-case hold fits in 50.
    await route({ priority: 0, providerKey: "provider-a", model: "a/small", input: 150, output: 600 });
    const { gateway } = liveGateway();
    const learner = await createCoachLearner(world);
    const h = harness({ overrides: (deps) => void (deps.gateway = gateway) });
    const result = await h.proxy.chat(coachCtx(learner.actor), ask("the chat reply never shows up when i press send"));
    expect(result.kind).toBe("reply");

    const [request] = await aiRequestsFor(learner.actor.userId);
    const cost = request?.costMillipence ?? 0;
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBe(Math.ceil(Number((((request?.inputTokens ?? 0) * 150 + (request?.outputTokens ?? 0) * 600) / 1_000).toFixed(6))));
    // Default pricing: 1 credit = 0.1p, margin 1.3.
    const expectedCredits = Math.ceil(Number((((cost / 1000) * 1.3) / 0.1).toFixed(6)));
    expect(expectedCredits).toBeGreaterThan(1);
    expect(result.meta.creditsCharged).toBe(expectedCredits);
    expect(request).toMatchObject({ providerKey: "provider-a", model: "a/small", creditsCharged: expectedCredits });

    const ledger = await ledgerFor(learner.actor.userId);
    const reserved = ledger.find((row) => row.entryType === "reserve")?.amount ?? 0;
    expect(reserved).toBeGreaterThanOrEqual(expectedCredits);
    expect(ledger.find((row) => row.entryType === "commit")?.amount).toBe(expectedCredits);
    expect(ledger.find((row) => row.entryType === "release")?.amount ?? 0).toBe(reserved - expectedCredits);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ reserved: 0, spent: expectedCredits });
    expect(result.energy?.balance).toBe(50 - expectedCredits);

    const spend = await db.select().from(spendCounter);
    expect(Object.fromEntries(spend.map((row) => [row.feature, row.costMillipence]))).toEqual({ tutor: cost, all: cost });
    // The learner is told about energy only.
    expect(JSON.stringify({ message: result.message, energy: result.energy, notices: result.notices })).not.toMatch(/£|pence|millipence/);
  });

  it("gives a safe refusal, with no provider call and no charge, when the only provider is not approved", async () => {
    await processor(GATEWAY_PROCESSOR_KEY, "enabled");
    await processor("provider-a", "approved_only");
    await route({ priority: 0, providerKey: "provider-a", model: "a/small", input: 250, output: 1000 });
    const { gateway, resolved } = liveGateway();
    const learner = await createCoachLearner(world);
    const h = harness({ overrides: (deps) => void (deps.gateway = gateway) });
    const result = await h.proxy.chat(coachCtx(learner.actor), ask("the chat reply never shows up when i press send"));
    expect(result).toMatchObject({ kind: "denied", code: "ai_unavailable", status: 503, message: COACH_COPY.unavailable, aiGenerated: false });
    expect(result.meta.stage).toBe("model_call");
    expect(resolved).toHaveLength(0);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ reserved: 0, spent: 0 });
    expect(await messagesFor(learner.actor.userId)).toHaveLength(0);
    expect(await db.select().from(spendCounter)).toHaveLength(0);
  });
});
