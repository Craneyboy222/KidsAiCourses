/**
 * Shared types for the Coach pipeline. Nothing here touches the database, the environment or a
 * model provider, so it is safe to import from tests, the eval script and the route handlers.
 */
import type { SafetyBand } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import type { CrisisScript } from "./crisis";
import type { Moderator } from "./moderation";

// ───────────────────────────── Request and result ─────────────────────────────

export type CoachRequest = {
  courseSlug: string;
  stepKey: string;
  message: string;
  conversationId?: string;
  /** Staff preview of a draft version. Uses no learner credits and saves nothing. */
  preview?: { versionId: string; asBand?: SafetyBand; /** Learner turns so far in this preview session (nothing is stored, so the panel says). Sets the hint-ladder rung. */ turn?: number };
  /** Only `tutor` is allowed. Present so that anything else can be refused explicitly. */
  feature?: string;
  /** Makes a retried request reserve credits once. Defaults to the request id. */
  idempotencyKey?: string;
};

/** Matches `ai_request_outcome` in the database. */
export type CoachOutcome = "ok" | "refused" | "blocked_input" | "blocked_output" | "crisis" | "denied" | "rate_limited" | "error";

/**
 * - `reply`: an approved, AI-generated answer.
 * - `crisis`: the fixed crisis script. Not AI-generated.
 * - `refusal`: Coach declined this message (secret, blocked input, homework, blocked output, fault). Fixed text.
 * - `denied`: Coach is not available to this person right now (signed out, paused, no energy…). An error to the API.
 */
export type CoachResultKind = "reply" | "crisis" | "refusal" | "denied";

export type CoachCode =
  | "ok"
  | "crisis"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "paused"
  | "time_cap_reached"
  | "quiet_hours"
  | "consent_required"
  | "age_assurance_required"
  | "coach_off"
  | "ai_break"
  | "rate_limited"
  | "busy"
  | "duplicate"
  | "credits_exhausted"
  | "secret_refused"
  | "input_blocked"
  | "homework_refused"
  | "output_blocked"
  | "ai_unavailable";

/** The energy meter. Whole numbers of "energy"; never money. */
export type EnergyView = { balance: number; monthlyAllowance: number; percent: number; resetsAt: string };

export const COACH_STAGES = [
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
] as const;
export type CoachStage = (typeof COACH_STAGES)[number];

export type CoachResult = {
  kind: CoachResultKind;
  code: CoachCode;
  outcome: CoachOutcome;
  /** HTTP status the API should use: 200 for anything shown in the chat, an error status for `denied`. */
  status: number;
  /** The text to show. For `reply` this is model output that passed every check; otherwise fixed copy. */
  message: string;
  aiGenerated: boolean;
  /** The label to show with the message. Every Coach message has one. */
  label: string;
  /** Things the learner should be told, such as what personal data was removed. */
  notices: string[];
  /** Null after a crisis turn and in preview, so the next message starts a fresh conversation. */
  conversationId: string | null;
  /** Id of the `ai_request` row: the target for the Report control. Null when nothing was recorded. */
  requestId: string | null;
  crisis: CrisisScript | null;
  energy: EnergyView | null;
  preview: boolean;
  /** For tests, logs and evals. Never sent to the browser. */
  meta: {
    stage: CoachStage;
    modelCalls: number;
    moderation: Record<string, number> | null;
    leakReasons: string[];
    regenerated: boolean;
    creditsCharged: number;
    costMillipence: number;
    caseOpened: boolean;
  };
  /** Resolves when background work (opening the safeguarding case) has finished. Never rejects. */
  settled: Promise<void>;
};

export const AI_LABEL = "AI-generated";
export const FIXED_LABEL = "Set message from Coach, an AI tutor";

// ───────────────────────────── What the pipeline knows about a step ─────────────────────────────

export type StepContext = {
  courseId: string | null;
  courseVersionId: string;
  courseSlug: string;
  courseTitle: string;
  moduleTitle: string;
  lessonTitle: string;
  enrolmentId: string | null;
  /** The materialised `step.id`, or null for a draft being previewed. */
  stepId: string | null;
  step: {
    key: string;
    type: string;
    title: string;
    body: string | null;
    /** What to do in the tool, for external tasks; the prompt for reflections. */
    task: string | null;
    coachContext: string | null;
    hints: string[];
    referenceSolution: string | null;
    toolSlug: string | null;
  };
  /** The setup guide the step walks through, if it is a guide step. */
  guide: { title: string; steps: Array<{ title: string; body: string }> } | null;
  rubric: Array<{ name: string; description: string }>;
};

// ───────────────────────────── Model gateway ─────────────────────────────

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type GatewayRequest = {
  alias: string;
  instructions: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
};

export type GatewayResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costMillipence: number;
  routeAlias: string;
  providerKey: string;
  model: string;
  latencyMs: number;
};

export type GatewayEstimate = { inputPencePerMillionTokens: number; outputPencePerMillionTokens: number };

export interface ModelGateway {
  /** Calls the first usable route for the alias. Throws if no approved route answers: callers fail closed. */
  generate(ctx: Ctx, request: GatewayRequest): Promise<GatewayResult>;
  /** Prices of the primary route, for the credit estimate. Zero for the fixture model. */
  prices(ctx: Ctx, alias: string): Promise<GatewayEstimate>;
}

// ───────────────────────────── Injected dependencies ─────────────────────────────

export type CoachSettings = {
  enabled: boolean;
  killSwitch: boolean;
  rateLimits: { perUserPerMin: number; perFamilyPerMin: number; perIpPerMin: number; globalConcurrency: number };
  creditValuePence: number;
  creditMargin: number;
  dailySpendCapPence: number;
};

export type LearningCheck =
  | { allowed: true }
  | { allowed: false; reason: "paused" | "time_cap" | "quiet_hours" | "consent" | "not_active"; message: string };

export type CoachEntitlement = { coachCreditsPerLearnerPerMonth: number; periodKey: string; planKey?: string };

export type ReserveOutcome =
  | { ok: true; reservationId: string; reserved: number; energy: EnergyView }
  /** `duplicate`: this idempotency key already has a hold, open or settled. It never buys a second model call. */
  | { ok: false; reason: "insufficient" | "duplicate"; energy: EnergyView };

export type RateScope = { scope: "user" | "family" | "ip"; id: string; limit: number; windowSec: number };

export type ConversationRef = {
  id: string;
  learnerId: string;
  flagged: boolean;
  /** Learner messages so far: sets the hint-ladder rung. */
  learnerTurns: number;
};

export type TurnRecord = {
  aiRequestId: string;
  /** The learner, or the staff member in preview. */
  userId: string;
  familyId: string | null;
  isPreview: boolean;
  outcome: CoachOutcome;
  errorCode: string | null;
  step: Pick<StepContext, "courseId" | "stepId" | "enrolmentId" | "courseTitle"> & { stepTitle: string } | null;
  conversation: { id: string; isNew: boolean } | null;
  moderation: Record<string, unknown> | null;
  routeAlias: string | null;
  providerKey: string | null;
  model: string | null;
  promptVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  costMillipence: number;
  creditsCharged: number;
  latencyMs: number;
  /**
   * Message text to keep, already stripped of personal data. Absent when nothing may be kept
   * (preview, refused secrets, ordinary blocks). The store encrypts it and sets `expires_at`.
   */
  content: { user: string; userRedacted: boolean; assistant: string | null } | null;
  /** Flagged content follows the safeguarding schedule and is DSL-only. */
  flagged: boolean;
  /** True when the learner's parent has agreed to the 90-day "resume chat" option. */
  extendedRetention: boolean;
};

export interface CoachStore {
  findConversation(ctx: Ctx, id: string): Promise<ConversationRef | null>;
  /** Recent, unflagged, unexpired messages for context, oldest first. */
  history(ctx: Ctx, conversationId: string, limit: number): Promise<ChatMessage[]>;
  /** Writes `ai_request` and, when `content` is present, the conversation and its encrypted messages. */
  record(ctx: Ctx, turn: TurnRecord): Promise<void>;
  linkCase(ctx: Ctx, conversationId: string, caseId: string): Promise<void>;
}

export type OpenCaseInput = {
  learnerId: string;
  severity: "critical" | "high";
  trigger: "crisis_classifier" | "abuse_disclosure" | "exploitation" | "grooming";
  summary: string;
  sourceType: string;
  sourceId: string | null;
  detail?: string;
};

export type CoachDeps = {
  settings(ctx: Ctx): Promise<CoachSettings>;
  people: {
    /** Accessibility preferences only. The pipeline never loads a learner's name. */
    a11y(ctx: Ctx, learnerId: string): Promise<Record<string, unknown>>;
    learningAllowed(ctx: Ctx, learnerId: string): Promise<LearningCheck>;
    ageAssured(ctx: Ctx, learnerId: string): Promise<boolean>;
    hasConsent(ctx: Ctx, learnerId: string, key: "ai_processing" | "tutor_history_retention"): Promise<boolean>;
    entitlement(ctx: Ctx, learnerId: string): Promise<CoachEntitlement>;
  };
  course: {
    /** The step in the learner's pinned version, or in the previewed draft. Null if Coach may not be used there. */
    resolveStep(ctx: Ctx, input: { courseSlug: string; stepKey: string; learnerId?: string; previewVersionId?: string }): Promise<StepContext | null>;
  };
  rateLimit: {
    hit(ctx: Ctx, name: string, scope: RateScope): Promise<{ allowed: boolean; retryAfterSec: number }>;
    acquire(ctx: Ctx, name: string, limit: number): Promise<{ release(): Promise<void> } | null>;
  };
  credits: {
    /** Credits a tutor message costs at least (`credit_price`, key `tutor.message`). */
    minimum(ctx: Ctx): Promise<number>;
    reserve(ctx: Ctx, input: { learnerId: string; familyId: string | null; amount: number; idempotencyKey: string; entitlement: CoachEntitlement }): Promise<ReserveOutcome>;
    commit(ctx: Ctx, input: { reservationId: string; amount: number; aiRequestId: string }): Promise<void>;
    release(ctx: Ctx, input: { reservationId: string; reason: string }): Promise<void>;
    energy(ctx: Ctx, learnerId: string, entitlement: CoachEntitlement): Promise<EnergyView>;
  };
  spend: {
    /** Adds to today's total and trips the kill switch at 100% of the cap. */
    record(ctx: Ctx, input: { feature: string; costMillipence: number }): Promise<void>;
  };
  moderator: Moderator;
  gateway: ModelGateway;
  safeguarding: { openCase(ctx: Ctx, input: OpenCaseInput): Promise<{ caseId: string }> };
  store: CoachStore;
  /**
   * Runs `work` so that everything it writes through the context it is given succeeds or fails
   * together (a database transaction). Used to record a reply and take its credits as one step.
   */
  atomic<T>(ctx: Ctx, work: (ctx: Ctx) => Promise<T>): Promise<T>;
  clock: { nowMs(): number; sleep(ms: number): Promise<void> };
  log: { warn(event: string, data?: unknown): void; error(event: string, error?: unknown, data?: unknown): void };
};
