/**
 * In-memory `CoachDeps`: every external service replaced by a small, inspectable fake.
 *
 * Used by the eval script (`pnpm eval:coach`), which must run with no database and no network,
 * and by tests that want the whole pipeline without Postgres. The detectors, the prompt assembly,
 * the crisis script and the pipeline itself are the real ones.
 */
import type { SafetyBand } from "@/server/authz/actor";
import { energyPercent } from "./cost";
import type { FixtureScript } from "./fixture-model";
import { createFixtureGateway } from "./gateway";
import { rulesModerator } from "./moderation";
import type { ChatMessage, CoachDeps, CoachSettings, EnergyView, OpenCaseInput, StepContext, TurnRecord } from "./types";

export const MEMORY_STEP: StepContext = {
  courseId: null,
  courseVersionId: "version-fixture",
  courseSlug: "build-your-own-snapchat-style-app",
  courseTitle: "Build Your Own Snapchat-Style App",
  moduleTitle: "Camera and filters",
  lessonTitle: "Make the camera work",
  enrolmentId: null,
  stepId: null,
  step: {
    key: "s5",
    type: "external_task",
    title: "Three built-in filters plus your signature filter",
    body: "Add three filters to your camera preview, then design one of your own.",
    task: "In your project, add a row of filter buttons. Each button changes how the preview looks. Then invent a fourth filter and give it a name.",
    coachContext: "Learners often attach the filter to the page instead of the preview. Do not write the filter code for them.",
    hints: ["Check which element the filter is applied to.", "A filter is one style property with a value.", "Try one built-in effect first, such as making the picture black and white."],
    referenceSolution:
      "const preview = document.querySelector('#preview');\nfunction setFilter(name) {\n  const filters = { none: 'none', mono: 'grayscale(1)', warm: 'sepia(0.6) saturate(1.4)', cool: 'hue-rotate(180deg)', mine: 'contrast(1.4) saturate(2) hue-rotate(45deg)' };\n  preview.style.filter = filters[name];\n}\ndocument.querySelectorAll('[data-filter]').forEach((button) => {\n  button.addEventListener('click', () => setFilter(button.dataset.filter));\n});",
    toolSlug: "replit",
  },
  guide: null,
  rubric: [
    { name: "It works", description: "The camera preview shows and each filter changes it." },
    { name: "It's yours", description: "The signature filter is your own idea and has a name." },
  ],
};

export type MemoryState = {
  settings: CoachSettings;
  balance: number;
  allowance: number;
  reserved: Map<string, number>;
  charged: number;
  records: TurnRecord[];
  cases: OpenCaseInput[];
  spendMillipence: number;
  modelCalls: number;
  history: ChatMessage[];
  learnerTurns: number;
  logs: Array<{ level: "warn" | "error"; event: string }>;
};

export type MemoryOptions = {
  step?: StepContext | null;
  band?: SafetyBand;
  balance?: number;
  allowance?: number;
  settings?: Partial<CoachSettings>;
  /** Recorded model outputs, used in order; the built-in fixture reply is used when they run out. */
  recordedOutputs?: string[];
  fixtureScript?: FixtureScript;
  history?: ChatMessage[];
  learnerTurns?: number;
};

export const DEFAULT_MEMORY_SETTINGS: CoachSettings = {
  enabled: true,
  killSwitch: false,
  rateLimits: { perUserPerMin: 8, perFamilyPerMin: 20, perIpPerMin: 30, globalConcurrency: 25 },
  creditValuePence: 0.1,
  creditMargin: 1.3,
  dailySpendCapPence: 2000,
};

export function createMemoryCoachDeps(options: MemoryOptions = {}): { deps: CoachDeps; state: MemoryState } {
  const state: MemoryState = {
    settings: { ...DEFAULT_MEMORY_SETTINGS, ...options.settings },
    balance: options.balance ?? 50,
    allowance: options.allowance ?? 50,
    reserved: new Map(),
    charged: 0,
    records: [],
    cases: [],
    spendMillipence: 0,
    modelCalls: 0,
    history: options.history ?? [],
    learnerTurns: options.learnerTurns ?? 0,
    logs: [],
  };
  const step = options.step === undefined ? MEMORY_STEP : options.step;
  const recorded = [...(options.recordedOutputs ?? [])];
  const inner = createFixtureGateway(options.fixtureScript ?? (() => recorded.shift()));
  const energy = (): EnergyView => ({
    balance: state.balance,
    monthlyAllowance: state.allowance,
    percent: energyPercent(state.balance, state.allowance),
    resetsAt: "2026-12-01T00:00:00.000Z",
  });

  const deps: CoachDeps = {
    settings: async () => state.settings,
    people: {
      a11y: async () => ({}),
      learningAllowed: async () => ({ allowed: true }),
      ageAssured: async () => true,
      hasConsent: async (_ctx, _id, key) => key === "ai_processing",
      entitlement: async () => ({ coachCreditsPerLearnerPerMonth: state.allowance, periodKey: "2026-11", planKey: "free" }),
    },
    course: { resolveStep: async () => step },
    rateLimit: {
      hit: async () => ({ allowed: true, retryAfterSec: 0 }),
      acquire: async () => ({ release: async () => undefined }),
    },
    credits: {
      minimum: async () => 1,
      reserve: async (_ctx, input) => {
        if (state.balance < input.amount) return { ok: false, reason: "insufficient", energy: energy() };
        state.balance -= input.amount;
        const reservationId = `reservation-${state.reserved.size + 1}`;
        state.reserved.set(reservationId, input.amount);
        return { ok: true, reservationId, reserved: input.amount, energy: energy() };
      },
      commit: async (_ctx, input) => {
        const held = state.reserved.get(input.reservationId) ?? 0;
        state.reserved.delete(input.reservationId);
        state.balance += held - input.amount;
        state.charged += input.amount;
      },
      release: async (_ctx, input) => {
        state.balance += state.reserved.get(input.reservationId) ?? 0;
        state.reserved.delete(input.reservationId);
      },
      energy: async () => energy(),
    },
    spend: {
      record: async (_ctx, input) => {
        state.spendMillipence += input.costMillipence;
      },
    },
    moderator: rulesModerator,
    gateway: {
      prices: (ctx, alias) => inner.prices(ctx, alias),
      generate: async (ctx, request) => {
        state.modelCalls += 1;
        return inner.generate(ctx, request);
      },
    },
    safeguarding: {
      openCase: async (_ctx, input) => {
        state.cases.push(input);
        return { caseId: `case-${state.cases.length}` };
      },
    },
    store: {
      findConversation: async (_ctx, id) => ({ id, learnerId: "learner-fixture", flagged: false, learnerTurns: state.learnerTurns }),
      history: async () => state.history,
      record: async (_ctx, turn) => {
        state.records.push(turn);
      },
      linkCase: async () => undefined,
    },
    clock: { nowMs: () => 0, sleep: async () => undefined },
    log: {
      warn: (event) => {
        state.logs.push({ level: "warn", event });
      },
      error: (event) => {
        state.logs.push({ level: "error", event });
      },
    },
  };
  return { deps, state };
}
