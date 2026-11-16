/**
 * Stage 8 of the Coach pipeline (spec Section 8): the model call, through the AI gateway.
 *
 * - An alias (`coach.default`) maps to an ordered list of routes in `model_route`; the first that
 *   answers wins and the rest are fallbacks.
 * - A provider is only ever called if it is approved as a data processor with a DPA on record
 *   (decision D1). An unapproved route is skipped; if none is left, the call fails and the
 *   pipeline refuses safely. Traffic goes through the Vercel AI Gateway, which is itself a
 *   processor and must be approved under `GATEWAY_PROCESSOR_KEY` as well.
 * - 30-second timeout, no automatic retries, and zero-data-retention / no-training options are
 *   requested on every call.
 * - `AI_PROVIDER_MODE=fixture` uses the built-in fixture model: no network, no approval, no cost.
 *
 * Everything external is injected, so tests never reach a provider. This module does not import
 * the database or the environment; `deps.ts` wires the real ones.
 */
import { generateText, type LanguageModel } from "ai";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { costMillipence } from "./cost";
import { FIXTURE_MODEL_ID, FIXTURE_PROVIDER_KEY, createFixtureModel, type FixtureScript } from "./fixture-model";
import type { GatewayEstimate, GatewayRequest, GatewayResult, ModelGateway } from "./types";

export const COACH_ROUTE_ALIAS = "coach.default";
export const MODEL_TIMEOUT_MS = 30_000;
/** The processor key under which the Vercel AI Gateway itself must be approved before any live call. */
export const GATEWAY_PROCESSOR_KEY = "vercel-ai-gateway";

export type ModelRoute = {
  alias: string;
  priority: number;
  providerKey: string;
  model: string;
  params: Record<string, unknown>;
  inputPencePerMillionTokens: number;
  outputPencePerMillionTokens: number;
};

export type GatewayDeps = {
  mode: "fixture" | "gateway";
  /** Enabled routes for an alias, lowest priority number first. */
  loadRoutes(ctx: Ctx, alias: string): Promise<ModelRoute[]>;
  /** Throws unless the provider is approved, enabled and has a DPA reference. */
  assertProcessorApproved(ctx: Ctx, providerKey: string): Promise<void>;
  /** Turns a route into an AI SDK model. Only called in `gateway` mode, after approval. */
  resolveModel(route: ModelRoute): LanguageModel;
  /** Replace the fixture model's replies (evals feed recorded outputs through this). */
  fixtureScript?: FixtureScript;
  timeoutMs?: number;
  nowMs?: () => number;
  warn?: (event: string, data?: unknown) => void;
};

const UNAVAILABLE = "Coach can't answer right now. Your steps and hints still work — try Coach again in a little while.";

const numberParam = (params: Record<string, unknown>, key: string, fallback: number): number => {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const stringList = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item): item is string => typeof item === "string") && value.length > 0 ? value : null;

export function createModelGateway(deps: GatewayDeps): ModelGateway {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? MODEL_TIMEOUT_MS;
  const fixture = deps.mode === "fixture" ? createFixtureModel(deps.fixtureScript) : null;

  async function call(model: LanguageModel, request: GatewayRequest, route: ModelRoute | null) {
    const params = route?.params ?? {};
    return generateText({
      model,
      instructions: request.instructions,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      maxOutputTokens: Math.min(request.maxOutputTokens, numberParam(params, "maxOutputTokens", request.maxOutputTokens)),
      temperature: numberParam(params, "temperature", 0.4),
      // One attempt per route: the fallbacks are the retry, and a slow provider must not hold a learner for minutes.
      maxRetries: 0,
      timeout: { totalMs: Math.min(timeoutMs, numberParam(params, "timeoutMs", timeoutMs)) },
      providerOptions: route
        ? {
            gateway: {
              // Ask for providers that keep nothing and train on nothing, and pin the call to the approved one.
              zeroDataRetention: params.zeroDataRetention !== false,
              disallowPromptTraining: params.disallowPromptTraining !== false,
              only: stringList(params.only) ?? [route.providerKey],
            },
          }
        : undefined,
    });
  }

  return {
    async prices(ctx: Ctx, alias: string): Promise<GatewayEstimate> {
      if (deps.mode === "fixture") return { inputPencePerMillionTokens: 0, outputPencePerMillionTokens: 0 };
      const routes = await deps.loadRoutes(ctx, alias);
      // Reserve against the dearest route, so a fallback can never cost more than was held.
      return {
        inputPencePerMillionTokens: Math.max(0, ...routes.map((r) => r.inputPencePerMillionTokens)),
        outputPencePerMillionTokens: Math.max(0, ...routes.map((r) => r.outputPencePerMillionTokens)),
      };
    },

    async generate(ctx: Ctx, request: GatewayRequest): Promise<GatewayResult> {
      const started = nowMs();

      if (fixture) {
        const result = await call(fixture, request, null);
        return {
          text: result.text,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          costMillipence: 0,
          routeAlias: request.alias,
          providerKey: FIXTURE_PROVIDER_KEY,
          model: FIXTURE_MODEL_ID,
          latencyMs: nowMs() - started,
        };
      }

      const routes = await deps.loadRoutes(ctx, request.alias);
      if (routes.length === 0) {
        throw new AppError("ai_unavailable", UNAVAILABLE, { detail: { reason: "no_route", alias: request.alias } });
      }
      // The gateway carries every call, so it is checked first and once. This throws when it is not approved.
      await deps.assertProcessorApproved(ctx, GATEWAY_PROCESSOR_KEY);

      const failures: Array<{ providerKey: string; model: string; reason: string }> = [];
      for (const route of [...routes].sort((a, b) => a.priority - b.priority)) {
        try {
          // Never call a provider that is not approved with a DPA on record (D1).
          await deps.assertProcessorApproved(ctx, route.providerKey);
        } catch {
          failures.push({ providerKey: route.providerKey, model: route.model, reason: "not_approved" });
          deps.warn?.("ai.gateway.route_not_approved", { alias: request.alias, providerKey: route.providerKey });
          continue;
        }
        try {
          const result = await call(deps.resolveModel(route), request, route);
          const usage = { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
          return {
            text: result.text,
            ...usage,
            costMillipence: costMillipence(usage, route),
            routeAlias: request.alias,
            providerKey: route.providerKey,
            model: route.model,
            latencyMs: nowMs() - started,
          };
        } catch (error) {
          // The error may quote the prompt. Keep only its name.
          const reason = error instanceof Error ? error.name : "error";
          failures.push({ providerKey: route.providerKey, model: route.model, reason });
          deps.warn?.("ai.gateway.route_failed", { alias: request.alias, providerKey: route.providerKey, model: route.model, reason });
        }
      }
      throw new AppError("ai_unavailable", UNAVAILABLE, { detail: { reason: "all_routes_failed", alias: request.alias, failures } });
    },
  };
}

/** A gateway that only ever uses the fixture model. For evals and tests that need no database. */
export function createFixtureGateway(fixtureScript?: FixtureScript): ModelGateway {
  return createModelGateway({
    mode: "fixture",
    fixtureScript,
    loadRoutes: async () => [],
    assertProcessorApproved: async () => {
      throw new Error("The fixture gateway never calls a provider");
    },
    resolveModel: () => {
      throw new Error("The fixture gateway never resolves a provider model");
    },
  });
}
