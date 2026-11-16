/**
 * `defaultCoachDeps()`: the real services behind the Coach pipeline. Tests and the eval script
 * never import this file; they inject fakes into `createCoachProxy` instead.
 */
import { createGateway } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { env } from "@/env";
import type { Ctx } from "@/server/context";
import { enrolment, modelRoute, step as stepTable } from "@/server/db";
import { AppError, isAppError } from "@/server/errors";
import { logError, logWarn } from "@/server/log";
import { assertProcessorApproved, isProcessorEnabled } from "@/server/processors";
import { acquireConcurrency, checkRateLimit, hashIp, releaseConcurrency } from "@/server/ratelimit";
import { isAgeAssuranceSatisfied } from "@/server/services/age-assurance";
import { hasConsent } from "@/server/services/consent";
import { getPublishedCourseBySlug, loadVersionContent } from "@/server/services/course-store";
import { commitCredits, getTutorMessagePrice, readCreditBalance, recordAiSpend, releaseCredits, reserveCredits, type CreditBalance } from "@/server/services/credits";
import { getEntitlementForLearner } from "@/server/services/entitlements";
import { getLearnerSummary } from "@/server/services/family";
import { openSafeguardingCase } from "@/server/services/safeguarding";
import { checkLearningAllowed } from "@/server/services/usage";
import { getSettings } from "@/server/settings/store";
import { energyPercent } from "./cost";
import { createModelGateway, type ModelRoute } from "./gateway";
import { rulesModerator } from "./moderation";
import { createCoachProxy, type CoachProxy } from "./proxy";
import { stepContextFromCourse } from "./step-context";
import { dbCoachStore } from "./store";
import type { CoachDeps, EnergyView, ModelGateway, StepContext } from "./types";

export const toEnergyView = (balance: CreditBalance): EnergyView => ({
  balance: balance.balance,
  monthlyAllowance: balance.monthlyAllowance,
  percent: energyPercent(balance.balance, balance.monthlyAllowance),
  resetsAt: balance.resetsAt.toISOString(),
});

/** Enabled routes for an alias, first choice first. */
export async function loadModelRoutes(ctx: Pick<Ctx, "db">, alias: string): Promise<ModelRoute[]> {
  const rows = await ctx.db
    .select()
    .from(modelRoute)
    .where(and(eq(modelRoute.alias, alias), eq(modelRoute.enabled, true)))
    .orderBy(asc(modelRoute.priority));
  return rows.map((row) => ({
    alias: row.alias,
    priority: row.priority,
    providerKey: row.providerKey,
    model: row.model,
    params: row.params,
    inputPencePerMillionTokens: row.inputPencePerMillionTokens,
    outputPencePerMillionTokens: row.outputPencePerMillionTokens,
  }));
}

/** Approved with a DPA on record (decision D1) AND switched on. Throws otherwise. */
export async function assertProcessorUsable(ctx: Pick<Ctx, "db">, providerKey: string): Promise<void> {
  await assertProcessorApproved(ctx, providerKey);
  if (!(await isProcessorEnabled(ctx, providerKey))) {
    throw new AppError("approval_required", "That provider is approved but not switched on.", { detail: { providerKey } });
  }
}

/** The gateway used by Coach and by course drafting. `fixture` unless `AI_PROVIDER_MODE=gateway`. */
export function defaultModelGateway(): ModelGateway {
  return createModelGateway({
    mode: env.AI_PROVIDER_MODE,
    loadRoutes: loadModelRoutes,
    assertProcessorApproved: assertProcessorUsable,
    resolveModel: (route) => {
      const key = env.AI_GATEWAY_API_KEY;
      if (!key) throw new AppError("ai_unavailable", "Coach can't answer right now.", { detail: { reason: "AI_GATEWAY_API_KEY is not set" } });
      return createGateway({ apiKey: key })(route.model);
    },
    warn: logWarn,
  });
}

/**
 * The step Coach is being asked about. For a learner: the step in the version their enrolment is
 * pinned to, on a course that is still published, and not taken down. For staff: the step in the
 * draft they are previewing. Anything else is null, which the pipeline reports as "not found".
 */
export async function resolveCoachStep(ctx: Ctx, input: { courseSlug: string; stepKey: string; learnerId?: string; previewVersionId?: string }): Promise<StepContext | null> {
  try {
    if (input.previewVersionId) {
      const content = await loadVersionContent(ctx, input.previewVersionId);
      if (content.slug !== input.courseSlug) return null;
      return stepContextFromCourse(content, input.stepKey, { courseId: null, courseVersionId: input.previewVersionId, enrolmentId: null, stepId: null });
    }
    if (!input.learnerId) return null;
    const published = await getPublishedCourseBySlug(ctx, input.courseSlug);
    if (!published) return null;
    const [pinned] = await ctx.db
      .select({ id: enrolment.id, versionId: enrolment.courseVersionId, status: enrolment.status })
      .from(enrolment)
      .where(and(eq(enrolment.learnerId, input.learnerId), eq(enrolment.courseId, published.course.id)))
      .limit(1);
    if (!pinned || pinned.status === "withdrawn") return null;
    const [row] = await ctx.db
      .select({ id: stepTable.id, disabled: stepTable.disabled })
      .from(stepTable)
      .where(and(eq(stepTable.courseVersionId, pinned.versionId), eq(stepTable.key, input.stepKey)))
      .limit(1);
    // A step that staff have taken down is closed to Coach as well.
    if (!row || row.disabled) return null;
    const content = pinned.versionId === published.version.id ? published.content : await loadVersionContent(ctx, pinned.versionId);
    return stepContextFromCourse(content, input.stepKey, { courseId: published.course.id, courseVersionId: pinned.versionId, enrolmentId: pinned.id, stepId: row.id });
  } catch (error) {
    if (isAppError(error) && (error.code === "not_found" || error.code === "forbidden")) return null;
    throw error;
  }
}

export function defaultCoachDeps(overrides: Partial<CoachDeps> = {}): CoachDeps {
  return {
    settings: async (ctx) => {
      const s = await getSettings(ctx, ["coach.enabled", "coach.kill_switch", "coach.rate_limits", "coach.credit_value_pence", "coach.credit_margin", "coach.daily_spend_cap_pence"] as const);
      return {
        enabled: s["coach.enabled"],
        killSwitch: s["coach.kill_switch"],
        rateLimits: s["coach.rate_limits"],
        creditValuePence: s["coach.credit_value_pence"],
        creditMargin: s["coach.credit_margin"],
        dailySpendCapPence: s["coach.daily_spend_cap_pence"],
      };
    },
    people: {
      a11y: async (ctx, learnerId) => (await getLearnerSummary(ctx, learnerId)).a11y,
      learningAllowed: async (ctx, learnerId) => {
        const result = await checkLearningAllowed(ctx, learnerId);
        return result.allowed ? { allowed: true } : { allowed: false, reason: result.reason, message: result.message };
      },
      ageAssured: (ctx, learnerId) => isAgeAssuranceSatisfied(ctx, learnerId),
      hasConsent: (ctx, learnerId, key) => hasConsent(ctx, learnerId, key),
      entitlement: (ctx, learnerId) => getEntitlementForLearner(ctx, learnerId),
    },
    course: { resolveStep: resolveCoachStep },
    rateLimit: {
      hit: async (ctx, name, scope) => {
        // An IP address is only ever used as a keyed hash.
        const key = scope.scope === "ip" ? `ip:${hashIp(scope.id)}` : `${scope.scope}:${scope.id}`;
        const result = await checkRateLimit(ctx, name, { limit: scope.limit, windowSec: scope.windowSec, key });
        return { allowed: result.allowed, retryAfterSec: result.retryAfterSec };
      },
      acquire: async (_ctx, name, limit) => {
        // Real time, not the request clock: a lease must run out even if a request hangs.
        const lease = await acquireConcurrency(name, limit);
        return lease ? { release: () => releaseConcurrency(lease) } : null;
      },
    },
    credits: {
      minimum: (ctx) => getTutorMessagePrice(ctx),
      reserve: async (ctx, input) => {
        const result = await reserveCredits(ctx, input);
        return result.ok
          ? { ok: true, reservationId: result.reservationId, reserved: result.reserved, energy: toEnergyView(result.balance) }
          : { ok: false, reason: "insufficient", energy: toEnergyView(result.balance) };
      },
      commit: async (ctx, input) => {
        await commitCredits(ctx, input);
      },
      release: async (ctx, input) => {
        await releaseCredits(ctx, input);
      },
      energy: async (ctx, learnerId, entitlement) => toEnergyView(await readCreditBalance(ctx, learnerId, entitlement)),
    },
    spend: {
      record: async (ctx, input) => {
        await recordAiSpend(ctx, input);
      },
    },
    moderator: rulesModerator,
    gateway: defaultModelGateway(),
    safeguarding: { openCase: (ctx, input) => openSafeguardingCase(ctx, input) },
    store: dbCoachStore,
    clock: { nowMs: () => performance.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    log: { warn: logWarn, error: logError },
    ...overrides,
  };
}

let proxy: CoachProxy | undefined;
/** The Coach pipeline with the real services, built once per server instance. */
export function getCoachProxy(): CoachProxy {
  return (proxy ??= createCoachProxy(defaultCoachDeps()));
}
