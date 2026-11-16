/**
 * Shared set-up for the Coach integration tests.
 *
 * Real: Postgres, the course store and publish services, consent, age assurance, rate limits,
 * settings, credits, the Coach store and the pipeline itself, with the built-in fixture model
 * (no network, no provider).
 *
 * Mocked, because their owning slices have not filled in the contract bodies yet (they still
 * throw `notImplemented`): `usage.checkLearningAllowed`, `entitlements.getEntitlementForLearner`
 * and `safeguarding.openSafeguardingCase`. Each test file declares the `vi.mock` calls; this
 * file gives the mocks their behaviour. The safeguarding mock writes a real `safeguarding_case`
 * row so that the foreign key from `tutor_conversation` is exercised.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { vi } from "vitest";
import { findStep } from "@/content/course-utils";
import type { FixtureScript } from "@/server/ai/fixture-model";
import { defaultCoachDeps } from "@/server/ai/deps";
import { createFixtureGateway } from "@/server/ai/gateway";
import { createCoachProxy, type CoachDeps, type CoachProxy, type CoachRequest, type GatewayRequest, type OpenCaseInput } from "@/server/ai/proxy";
import type { LearnerActor, ParentActor, StaffActor } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { decrypt } from "@/server/crypto";
import { aiMessage, aiRequest, creditBalance, creditLedger, enrolment, family, safeguardingCase, siteSetting, step, tutorConversation } from "@/server/db";
import { getEntitlementForLearner, type Entitlement } from "@/server/services/entitlements";
import { publishVersion } from "@/server/services/publish";
import { openSafeguardingCase } from "@/server/services/safeguarding";
import { checkLearningAllowed, type LearningAllowed } from "@/server/services/usage";
import { approvedCourse, ctxFor, setUpRegister, staff } from "../content/helpers";
import { db, resetDb, testCtx } from "../../helpers/db";
import { createConsentDefinition, createFamily, createLearner, recordConsent } from "../../helpers/factories";

export const COURSE_SLUG = "build-your-own-snapchat-style-app";
/** A step of the Snapchat course that has `coachContext` and hints. */
export const STEP_KEY = "s6";
export const NOW = new Date("2026-11-16T10:00:00.000Z");
export const PERIOD = "2026-11";

/** The step used by most tests: an external task with `coachContext`, a task and three hints. */
export const REFERENCE_SOLUTION =
  "const preview = document.querySelector('#preview');\nfunction setFilter(name) {\n  const filters = { none: 'none', mono: 'grayscale(1)', warm: 'sepia(0.6) saturate(1.4)', cool: 'hue-rotate(180deg)', mine: 'contrast(1.4) saturate(2) hue-rotate(45deg)' };\n  preview.style.filter = filters[name];\n}\ndocument.querySelectorAll('[data-filter]').forEach((button) => {\n  button.addEventListener('click', () => setFilter(button.dataset.filter));\n});";
/** The step that carries `REFERENCE_SOLUTION` in the fixture course. */
export const SOLUTION_STEP_KEY = "s5";

export type World = { courseId: string; versionId: string; editor: StaffActor; owner: StaffActor; coachContext: string; hints: string[] };

/** Empties the database, then publishes the Snapchat course and creates the consent wording. Once per file. */
export async function setUpWorld(): Promise<World> {
  await resetDb();
  await setUpRegister();
  const editor = await staff("editor");
  const reviewer = await staff("reviewer");
  const owner = await staff("super_admin");
  let coachContext = "";
  let hints: string[] = [];
  const approved = await approvedCourse(editor, reviewer, (course) => {
    const solutionStep = findStep(course, SOLUTION_STEP_KEY)?.step;
    const mainStep = findStep(course, STEP_KEY)?.step;
    if (!solutionStep || !mainStep?.coachContext || mainStep.hints.length === 0) throw new Error("The fixture course no longer has the steps these tests rely on");
    solutionStep.config = { ...solutionStep.config, referenceSolution: REFERENCE_SOLUTION };
    coachContext = mainStep.coachContext;
    hints = mainStep.hints;
  });
  await publishVersion(ctxFor(owner), approved.version.id);
  for (const key of ["account_learning_data", "ai_processing", "third_party_tools"]) await createConsentDefinition({ key, required: true });
  await createConsentDefinition({ key: "tutor_history_retention", required: false });
  return { courseId: approved.course.id, versionId: approved.version.id, editor, owner, coachContext, hints };
}

/** Clears what one test leaves behind that the next must not see. Learners and families are new each time. */
export async function resetBetweenTests(): Promise<void> {
  await db.execute(sql`DELETE FROM site_setting WHERE key LIKE 'coach.%'`);
  await db.execute(sql`DELETE FROM spend_counter`);
  await db.execute(sql`DELETE FROM rate_limit_bucket`);
  await db.execute(sql`DELETE FROM notification`);
  resetServiceMocks();
}

// ───────────────────────────── The mocked contract services ─────────────────────────────

export const mocks = {
  entitlement: { planKey: "free", fullCatalogue: false, seats: 2, coachCreditsPerLearnerPerMonth: 50, status: "none", periodKey: PERIOD } as Entitlement,
  learning: { allowed: true, minutesLeftToday: null } as LearningAllowed,
  /** Every call to `openSafeguardingCase`, in order. */
  cases: [] as OpenCaseInput[],
  /** How many of the next `openSafeguardingCase` calls should throw. */
  failCaseOpens: 0,
};

export function resetServiceMocks(): void {
  mocks.entitlement = { planKey: "free", fullCatalogue: false, seats: 2, coachCreditsPerLearnerPerMonth: 50, status: "none", periodKey: PERIOD };
  mocks.learning = { allowed: true, minutesLeftToday: null };
  mocks.cases = [];
  mocks.failCaseOpens = 0;
  vi.mocked(getEntitlementForLearner).mockReset().mockImplementation(async () => mocks.entitlement);
  vi.mocked(checkLearningAllowed).mockReset().mockImplementation(async () => mocks.learning);
  vi.mocked(openSafeguardingCase)
    .mockReset()
    .mockImplementation(async (ctx, input) => {
      mocks.cases.push(input as OpenCaseInput);
      if (mocks.failCaseOpens > 0) {
        mocks.failCaseOpens -= 1;
        throw new Error("safeguarding service is down");
      }
      const [row] = await ctx.db
        .insert(safeguardingCase)
        .values({ learnerId: input.learnerId ?? null, severity: input.severity, trigger: input.trigger === "crisis_classifier" ? "crisis_classifier" : "disclosure" })
        .returning({ id: safeguardingCase.id });
      if (!row) throw new Error("the safeguarding mock could not insert a case");
      return { caseId: row.id };
    });
}

// ───────────────────────────── People ─────────────────────────────

export type TestLearner = { actor: LearnerActor; parent: ParentActor; familyId: string; enrolmentId: string | null };

/**
 * A learner who may use Coach: an active account in a family whose adult has passed the card
 * check, every required consent given, and enrolled on the published course. Each option removes
 * one of those so a test can show the pipeline stopping.
 */
export async function createCoachLearner(
  world: World,
  options: { age?: number; assured?: boolean; consents?: string[]; enrolled?: boolean; status?: "active" | "paused"; retentionConsent?: boolean } = {},
): Promise<TestLearner> {
  const { family: familyRow, parentActor } = await createFamily();
  if (options.assured !== false) await db.update(family).set({ ageAssuranceLevel: "card_authorisation" }).where(eq(family.id, familyRow.id));
  const learner = await createLearner({ age: options.age ?? 14, familyId: familyRow.id, status: options.status ?? "active", now: NOW });
  const consents = options.consents ?? ["account_learning_data", "ai_processing", "third_party_tools"];
  for (const consentKey of [...consents, ...(options.retentionConsent ? ["tutor_history_retention"] : [])]) {
    await recordConsent({ learnerId: learner.user.id, actorUserId: parentActor.userId, familyId: familyRow.id, consentKey });
  }
  let enrolmentId: string | null = null;
  if (options.enrolled !== false) {
    const [row] = await db.insert(enrolment).values({ learnerId: learner.user.id, courseId: world.courseId, courseVersionId: world.versionId }).returning({ id: enrolment.id });
    enrolmentId = row?.id ?? null;
  }
  return { actor: learner.actor, parent: parentActor, familyId: familyRow.id, enrolmentId };
}

/** A brother or sister in the same family, also set up to use Coach. */
export async function createLearnerInFamily(world: World, sibling: TestLearner, options: { age?: number } = {}): Promise<TestLearner> {
  const learner = await createLearner({ age: options.age ?? 15, familyId: sibling.familyId, now: NOW });
  for (const consentKey of ["account_learning_data", "ai_processing", "third_party_tools"]) {
    await recordConsent({ learnerId: learner.user.id, actorUserId: sibling.parent.userId, familyId: sibling.familyId, consentKey });
  }
  const [row] = await db.insert(enrolment).values({ learnerId: learner.user.id, courseId: world.courseId, courseVersionId: world.versionId }).returning({ id: enrolment.id });
  return { actor: learner.actor, parent: sibling.parent, familyId: sibling.familyId, enrolmentId: row?.id ?? null };
}

/** A request context with the clock pinned and an IP address of its own, so that tests never share a rate-limit bucket. */
export function coachCtx(actor: Ctx["actor"], overrides: Partial<Ctx> = {}): Ctx {
  const octet = () => 1 + Math.floor(Math.random() * 250);
  return testCtx(actor, { now: NOW, ip: `198.51.${octet()}.${octet()}`, requestId: `coach-test-${randomUUID()}`, ...overrides });
}

export const ask = (message: string, extra: Partial<CoachRequest> = {}): CoachRequest => ({ courseSlug: COURSE_SLUG, stepKey: STEP_KEY, message, feature: "tutor", ...extra });

// ───────────────────────────── The pipeline, with a model we can watch ─────────────────────────────

export type Harness = {
  proxy: CoachProxy;
  deps: CoachDeps;
  /** Everything sent to the model. Its length is the number of model calls. */
  modelRequests: GatewayRequest[];
  logs: Array<{ level: "warn" | "error"; event: string }>;
};

/**
 * The real pipeline on the real services (`defaultCoachDeps`), with the fixture gateway wrapped
 * so that a test can count model calls and see exactly what the model was sent. `outputs` are
 * used as the model's replies in order; after that the built-in fixture reply is used.
 */
export function harness(options: { outputs?: string[]; script?: FixtureScript; overrides?: (deps: CoachDeps) => void } = {}): Harness {
  const outputs = [...(options.outputs ?? [])];
  const inner = createFixtureGateway(options.script ?? (() => outputs.shift()));
  const modelRequests: GatewayRequest[] = [];
  const logs: Harness["logs"] = [];
  const deps = defaultCoachDeps({
    gateway: {
      prices: (ctx, alias) => inner.prices(ctx, alias),
      generate: async (ctx, request) => {
        modelRequests.push(request);
        return inner.generate(ctx, request);
      },
    },
    // No real waiting between retries, and the pipeline's log lines are kept for assertions.
    clock: { nowMs: () => performance.now(), sleep: async () => undefined },
    log: { warn: (event) => void logs.push({ level: "warn", event }), error: (event) => void logs.push({ level: "error", event }) },
  });
  // `defaultCoachDeps` shares some objects between calls (the store is a module-level singleton).
  // Copy every group, so that a test which breaks one service on purpose breaks only its own copy.
  deps.people = { ...deps.people };
  deps.course = { ...deps.course };
  deps.rateLimit = { ...deps.rateLimit };
  deps.credits = { ...deps.credits };
  deps.spend = { ...deps.spend };
  deps.safeguarding = { ...deps.safeguarding };
  deps.store = { ...deps.store };
  options.overrides?.(deps);
  return { proxy: createCoachProxy(deps), deps, modelRequests, logs };
}

// ───────────────────────────── Reading back what was written ─────────────────────────────

export async function aiRequestsFor(userId: string) {
  return db.select().from(aiRequest).where(eq(aiRequest.userId, userId)).orderBy(aiRequest.createdAt);
}

export async function conversationsFor(learnerId: string) {
  return db.select().from(tutorConversation).where(eq(tutorConversation.learnerId, learnerId));
}

export async function messagesFor(learnerId: string) {
  const rows = await db.select().from(aiMessage).where(eq(aiMessage.learnerId, learnerId)).orderBy(aiMessage.createdAt);
  return rows.map((row) => ({ ...row, text: decrypt(row.contentEncrypted, "content") }));
}

export async function ledgerFor(learnerId: string) {
  return db.select().from(creditLedger).where(eq(creditLedger.learnerId, learnerId)).orderBy(creditLedger.createdAt, creditLedger.entryType);
}

export async function balanceFor(learnerId: string, periodKey: string = PERIOD) {
  const rows = await db.select().from(creditBalance).where(eq(creditBalance.learnerId, learnerId));
  return rows.find((row) => row.periodKey === periodKey) ?? null;
}

/** `granted - reserved - spent - expired` for the period, or null before the first use. */
export async function availableFor(learnerId: string, periodKey: string = PERIOD): Promise<number | null> {
  const row = await balanceFor(learnerId, periodKey);
  return row ? row.granted - row.reserved - row.spent - row.expired : null;
}

/** The materialised step row for a key in the published version. */
export async function stepRow(world: World, key: string = STEP_KEY) {
  const rows = await db.select().from(step).where(eq(step.courseVersionId, world.versionId));
  const row = rows.find((candidate) => candidate.key === key);
  if (!row) throw new Error(`No step ${key} in the published version`);
  return row;
}

/** Writes a Coach setting straight to `site_setting`, as Studio's AI controls would. */
export async function setCoachSetting(key: "coach.enabled" | "coach.kill_switch" | "coach.rate_limits" | "coach.daily_spend_cap_pence" | "coach.credit_value_pence" | "coach.credit_margin", value: unknown): Promise<void> {
  await db.insert(siteSetting).values({ key, value }).onConflictDoUpdate({ target: siteSetting.key, set: { value } });
}

export const RATE_LIMITS = { perUserPerMin: 8, perFamilyPerMin: 20, perIpPerMin: 30, globalConcurrency: 25 };
