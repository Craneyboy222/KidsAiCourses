/**
 * The Coach pipeline (spec Section 8): the only path from a learner's message to a model and back.
 *
 *   browser → our API → [1..7 policy checks] → [8 AI gateway] → [9 output checks] → [10 record] → [11 browser]
 *
 * It is one composable module built from small stage functions. Every stage takes the state so
 * far and returns either "continue" with more state, or a terminal result with a friendly
 * message. Everything outside this file is injected through `CoachDeps` (`deps.ts` wires the real
 * services; tests and the eval script inject fakes), so this module imports no database, no
 * environment and no provider.
 *
 * Three rules hold throughout:
 *  - FAIL CLOSED. If any stage throws, the learner gets a safe message and no model is called.
 *  - A crisis disclosure always gets the fixed script. Before anyone is turned away for a
 *    non-safety reason (no energy, rate limit, quiet hours, a fault…), the message is checked
 *    locally for crisis signals, so a child in trouble is never answered with "try again later".
 *  - The learner never sees unmoderated model text. Output is buffered here, checked, and only
 *    then handed to the route, which streams the approved text.
 */
import { randomUUID } from "node:crypto";
import { formatDate } from "@/lib/dates";
import { can } from "@/server/authz";
import type { SafetyBand } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { estimateCredits, creditsToCommit } from "./cost";
import { CRISIS_SCRIPT_VERSION, getCrisisScript, openCaseWithRetry, renderCrisisText } from "./crisis";
import { COACH_ROUTE_ALIAS } from "./gateway";
import { detectLeak } from "./leak";
import { detectCrisis, type CrisisSignal, type ModerationVerdict } from "./moderation";
import { COACH_PROMPT_VERSION, CRISIS_SENTINEL, assemblePrompt, correctiveReasons, type AssembledPrompt } from "./prompts";
import { redactInput, scrubForStorage } from "./redact";
import {
  AI_LABEL,
  FIXED_LABEL,
  type ChatMessage,
  type CoachCode,
  type CoachDeps,
  type CoachEntitlement,
  type CoachOutcome,
  type CoachRequest,
  type CoachResult,
  type CoachResultKind,
  type CoachSettings,
  type CoachStage,
  type EnergyView,
  type GatewayResult,
  type StepContext,
  type TurnRecord,
} from "./types";

export * from "./types";

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_OUTPUT_TOKENS = 400;
export const HISTORY_MESSAGES = 6;
/** A generous allowance for the system prompt, step notes and history when estimating the reservation. */
const PROMPT_OVERHEAD_CHARS = 16_000;
/** At most this many safeguarding cases per learner in ten minutes; the script itself is never limited. */
const CRISIS_CASE_LIMIT = { limit: 3, windowSec: 600 };

// ───────────────────────────── Copy (fixed, teen-friendly) ─────────────────────────────

export const COACH_COPY = {
  signIn: "Please sign in to use Coach.",
  learnersOnly: "Coach is for learner accounts.",
  conversationMissing: "That chat couldn't be found. Start a new one and ask again.",
  paused: "This account is paused at the moment, so Coach isn't available. A parent or carer can sort it out from their dashboard.",
  ageAssurance:
    "Coach isn't switched on for your account yet. A parent or carer needs to finish a quick check first — ask them to look at their dashboard. Your steps and hints work in the meantime.",
  consent:
    "Coach needs a parent or carer to say yes to AI help first. Ask them to check the permissions in their dashboard. Your steps and hints work in the meantime.",
  featureOnly: "Coach can only be used as a tutor on a course step.",
  empty: "Type a question for Coach first.",
  tooLong: "That message is too long for Coach. Try a shorter one — under 2,000 characters.",
  coachOff: "Coach is switched off at the moment. Your steps and hints still work.",
  aiBreak: "AI break — back soon. Coach is having a rest, but your steps and hints still work.",
  stepMissing: "Coach isn't available on that step. Open the step from your course and try again.",
  busy: "Coach is really busy right now. Wait a few seconds, then try again.",
  duplicate: "That message was already sent, so it wasn't sent twice. If no answer came back, ask again.",
  unavailable: "Coach can't answer right now. Nothing was lost and no energy was used. Your steps and hints still work — try Coach again in a little while.",
  outputBlocked:
    "I couldn't put together a helpful hint for that one, so I've stopped rather than risk giving you the answer. No energy was used. Try asking in a different way, or tell me what you've tried so far.",
  previewCrisisNote: "Staff preview: a learner would see this script, and a safeguarding case would be opened. Nothing was saved.",
} as const;

const waitText = (seconds: number): string => {
  const s = Math.max(1, Math.ceil(seconds));
  return s < 60 ? `about ${s} second${s === 1 ? "" : "s"}` : `about ${Math.ceil(s / 60)} minute${Math.ceil(s / 60) === 1 ? "" : "s"}`;
};
const rateLimitedCopy = (retryAfterSec: number): string => `That's a lot of messages in a short time. Give it ${waitText(retryAfterSec)}, then try again.`;
const outOfEnergyCopy = (energy: EnergyView): string =>
  `You're out of Coach energy for now. It tops up on ${formatDate(energy.resetsAt)}. Your steps and hints still work, and a parent or carer can see the options if you'd like more.`;

// ───────────────────────────── State ─────────────────────────────

type Identity =
  | { mode: "live"; userId: string; familyId: string | null; band: SafetyBand; a11y: Record<string, unknown> }
  | { mode: "preview"; userId: string; familyId: null; band: SafetyBand; a11y: Record<string, unknown> };

type Terminal = {
  kind: CoachResultKind;
  code: CoachCode;
  outcome: CoachOutcome;
  status: number;
  message: string;
  errorCode?: string;
  crisis?: CrisisSignal;
  /** Keep the learner's message under the safeguarding schedule (crisis, and sexual content involving a minor). */
  flagContent?: boolean;
  /** Open a case without showing the script (sexual content involving a minor). */
  safeguarding?: { severity: "critical"; trigger: "crisis_classifier"; categories: string[] };
};

type State = {
  ctx: Ctx;
  request: CoachRequest;
  aiRequestId: string;
  startedMs: number;
  identity?: Identity;
  conversation?: { id: string; isNew: boolean; learnerTurns: number };
  settings?: CoachSettings;
  step?: StepContext;
  lease?: { release(): Promise<void> };
  entitlement?: CoachEntitlement;
  reservation?: { id: string; amount: number };
  energy?: EnergyView;
  minimumCredits?: number;
  cleanText?: string;
  redacted: boolean;
  notices: string[];
  inputVerdict?: ModerationVerdict;
  history: ChatMessage[];
  prompt?: AssembledPrompt;
  generations: GatewayResult[];
  reply?: string;
  outputVerdict?: ModerationVerdict;
  leakReasons: string[];
  regenerated: boolean;
};

type StageResult = { continue: true; state: State } | { continue: false; state: State; result: Terminal };
type Stage = (state: State, deps: CoachDeps) => Promise<StageResult>;

const go = (state: State): StageResult => ({ continue: true, state });
const halt = (state: State, result: Terminal): StageResult => ({ continue: false, state, result });

const denied = (code: CoachCode, status: number, message: string, outcome: CoachOutcome = "denied"): Terminal => ({ kind: "denied", code, outcome, status, message });
const refusal = (code: CoachCode, outcome: CoachOutcome, message: string, extra: Partial<Terminal> = {}): Terminal => ({ kind: "refusal", code, outcome, status: 200, message, ...extra });
const crisisTerminal = (signal: CrisisSignal): Terminal => ({ kind: "crisis", code: "crisis", outcome: "crisis", status: 200, message: "", crisis: signal, flagContent: true });
const faultTerminal = (errorCode: string): Terminal => ({ kind: "denied", code: "ai_unavailable", outcome: "error", status: 503, message: COACH_COPY.unavailable, errorCode });

// ───────────────────────────── Stage 1: AuthN / AuthZ ─────────────────────────────

const authStage: Stage = async (state, deps) => {
  const { ctx, request } = state;
  const { actor } = ctx;
  if (actor.type === "anonymous" || actor.type === "system") return halt(state, denied("unauthenticated", 401, COACH_COPY.signIn));

  if (request.preview) {
    // Staff preview of a draft. To anyone else a draft does not exist.
    if (actor.type !== "staff" || !can(actor, "course.preview")) return halt(state, denied("not_found", 404, COACH_COPY.stepMissing));
    const identity: Identity = { mode: "preview", userId: actor.userId, familyId: null, band: request.preview.asBand ?? "teen_13_15", a11y: {} };
    return go({ ...state, identity });
  }

  if (actor.type !== "learner") return halt(state, denied("forbidden", 403, COACH_COPY.learnersOnly));
  // From here the learner is known, so the crisis safety net can work even if a later check turns them away.
  let next: State = {
    ...state,
    identity: { mode: "live", userId: actor.userId, familyId: actor.familyId, band: actor.safetyBand, a11y: {} },
    conversation: { id: randomUUID(), isNew: true, learnerTurns: 0 },
  };

  if (request.conversationId) {
    const found = await deps.store.findConversation(ctx, request.conversationId);
    if (!found) return halt(next, denied("not_found", 404, COACH_COPY.conversationMissing));
    // A learner may only ever act on their own records: the owner is read from the row, never from the request.
    if (found.learnerId !== actor.userId) return halt(next, denied("forbidden", 403, COACH_COPY.conversationMissing));
    // A flagged conversation is closed to the learner (DSL access only): carry on in the fresh one.
    if (!found.flagged) next = { ...next, conversation: { id: found.id, isNew: false, learnerTurns: found.learnerTurns } };
  }

  if (!can(actor, "learner.coach.chat", { learnerId: actor.userId })) {
    return halt(next, actor.status === "active" ? denied("forbidden", 403, COACH_COPY.learnersOnly) : denied("paused", 403, COACH_COPY.paused));
  }

  const learning = await deps.people.learningAllowed(ctx, actor.userId);
  if (!learning.allowed) {
    const code: CoachCode =
      learning.reason === "time_cap" ? "time_cap_reached" : learning.reason === "quiet_hours" ? "quiet_hours" : learning.reason === "consent" ? "consent_required" : "paused";
    return halt(next, denied(code, 403, learning.message));
  }
  // Consent first: age assurance also fails while a required consent is missing, and "a parent needs
  // to say yes to AI help" is the more exact thing to tell a learner whose parent has not agreed.
  if (!(await deps.people.hasConsent(ctx, actor.userId, "ai_processing"))) return halt(next, denied("consent_required", 403, COACH_COPY.consent));
  if (!(await deps.people.ageAssured(ctx, actor.userId))) return halt(next, denied("age_assurance_required", 403, COACH_COPY.ageAssurance));

  const a11y = await deps.people.a11y(ctx, actor.userId);
  return go({ ...next, identity: { mode: "live", userId: actor.userId, familyId: actor.familyId, band: actor.safetyBand, a11y } });
};

// ───────────────────────────── Stage 2: capability ─────────────────────────────

const capabilityStage: Stage = async (state, deps) => {
  const { ctx, request, identity } = state;
  if (!identity) throw new Error("capability stage reached without an identity");
  if ((request.feature ?? "tutor") !== "tutor") return halt(state, denied("forbidden", 403, COACH_COPY.featureOnly));
  const text = request.message.trim();
  if (text.length === 0) return halt(state, denied("invalid_input", 422, COACH_COPY.empty));
  if (text.length > MAX_MESSAGE_CHARS) return halt(state, denied("invalid_input", 422, COACH_COPY.tooLong));

  const settings = await deps.settings(ctx);
  if (!settings.enabled) return halt({ ...state, settings }, denied("coach_off", 503, COACH_COPY.coachOff));
  if (settings.killSwitch) return halt({ ...state, settings }, denied("ai_break", 503, COACH_COPY.aiBreak));

  const step = await deps.course.resolveStep(
    ctx,
    identity.mode === "preview"
      ? { courseSlug: request.courseSlug, stepKey: request.stepKey, previewVersionId: request.preview?.versionId }
      : { courseSlug: request.courseSlug, stepKey: request.stepKey, learnerId: identity.userId },
  );
  if (!step) return halt({ ...state, settings }, denied("not_found", 404, COACH_COPY.stepMissing));
  return go({ ...state, settings, step });
};

// ───────────────────────────── Stage 3: rate limits ─────────────────────────────

const rateLimitStage: Stage = async (state, deps) => {
  const { ctx, identity, settings } = state;
  if (!identity || !settings) throw new Error("rate-limit stage reached without identity or settings");
  const limits = settings.rateLimits;
  const scopes = [
    { scope: "user" as const, id: identity.userId, limit: limits.perUserPerMin, windowSec: 60 },
    ...(identity.familyId ? [{ scope: "family" as const, id: identity.familyId, limit: limits.perFamilyPerMin, windowSec: 60 }] : []),
    ...(ctx.ip ? [{ scope: "ip" as const, id: ctx.ip, limit: limits.perIpPerMin, windowSec: 60 }] : []),
  ];
  for (const scope of scopes) {
    const hit = await deps.rateLimit.hit(ctx, "coach.chat", scope);
    if (!hit.allowed) return halt(state, denied("rate_limited", 429, rateLimitedCopy(hit.retryAfterSec), "rate_limited"));
  }
  const lease = await deps.rateLimit.acquire(ctx, "coach.model", limits.globalConcurrency);
  if (!lease) return halt(state, denied("busy", 429, COACH_COPY.busy, "rate_limited"));
  return go({ ...state, lease });
};

// ───────────────────────────── Stage 4: credit reservation ─────────────────────────────

const creditStage: Stage = async (state, deps) => {
  const { ctx, identity, settings, request } = state;
  if (!identity || !settings) throw new Error("credit stage reached without identity or settings");
  // Staff preview never touches learner credits.
  if (identity.mode === "preview") return go(state);

  const [entitlement, minimumCredits, prices] = await Promise.all([
    deps.people.entitlement(ctx, identity.userId),
    deps.credits.minimum(ctx),
    deps.gateway.prices(ctx, COACH_ROUTE_ALIAS),
  ]);
  const pricing = { creditValuePence: settings.creditValuePence, creditMargin: settings.creditMargin, minimumCredits };
  const estimate = estimateCredits({ promptChars: PROMPT_OVERHEAD_CHARS + request.message.length, maxOutputTokens: MAX_OUTPUT_TOKENS, attempts: 2 }, prices, pricing);
  const reserved = await deps.credits.reserve(ctx, {
    learnerId: identity.userId,
    familyId: identity.familyId,
    amount: estimate.credits,
    idempotencyKey: `tutor:${request.idempotencyKey ?? ctx.requestId}`,
    entitlement,
  });
  const next = { ...state, entitlement, minimumCredits, energy: reserved.energy };
  if (!reserved.ok) {
    // A key that has been used before buys nothing more: one hold pays for one model call. Without
    // this, replaying a request id would get any number of answers for the price of one. The
    // earlier hold is deliberately not attached here, so this turn can neither spend nor release it.
    if (reserved.reason === "duplicate") return halt(next, denied("duplicate", 409, COACH_COPY.duplicate));
    return halt(next, denied("credits_exhausted", 402, outOfEnergyCopy(reserved.energy)));
  }
  return go({ ...next, reservation: { id: reserved.reservationId, amount: reserved.reserved } });
};

// ───────────────────────────── Stage 5: input sanitisation ─────────────────────────────

const sanitiseStage: Stage = async (state) => {
  const result = redactInput(state.request.message.trim(), { now: state.ctx.now });
  if (result.refused) return halt(state, refusal("secret_refused", "refused", result.message));
  return go({ ...state, cleanText: result.text, redacted: result.redactions.length > 0, notices: result.notice ? [...state.notices, result.notice] : state.notices });
};

// ───────────────────────────── Stage 6: input moderation ─────────────────────────────

const inputModerationStage: Stage = async (state, deps) => {
  const { identity, cleanText } = state;
  if (!identity || cleanText === undefined) throw new Error("moderation stage reached without sanitised text");
  const verdict = await deps.moderator.moderate({ text: cleanText, direction: "input", band: identity.band });
  const next = { ...state, inputVerdict: verdict };

  if (verdict.action === "crisis" && verdict.crisis) return halt(next, crisisTerminal(verdict.crisis));
  // Belt and braces: whatever the injected moderator said, the local crisis rules also look at the
  // message as it was typed, before anything was stripped from it.
  const local = detectCrisis(state.request.message, identity.band);
  if (local) return halt(next, crisisTerminal(local));

  if (verdict.action === "block") {
    return halt(
      next,
      refusal("input_blocked", "blocked_input", verdict.message ?? COACH_COPY.unavailable, verdict.safeguarding ? { safeguarding: verdict.safeguarding, flagContent: true } : {}),
    );
  }
  if (verdict.action === "refuse") return halt(next, refusal("homework_refused", "refused", verdict.message ?? COACH_COPY.unavailable));
  if (verdict.action !== "allow") throw new Error(`Unknown moderation action: ${String(verdict.action)}`);
  return go(next);
};

// ───────────────────────────── Stage 7: prompt assembly ─────────────────────────────

const promptStage: Stage = async (state, deps) => {
  const { ctx, identity, step, cleanText, conversation, request } = state;
  if (!identity || !step || cleanText === undefined) throw new Error("prompt stage reached without its inputs");
  const live = identity.mode === "live" && conversation && !conversation.isNew;
  const history = live ? await deps.store.history(ctx, conversation.id, HISTORY_MESSAGES) : [];
  const learnerTurnsSoFar = identity.mode === "preview" ? Math.max(0, Math.min(10, Math.floor(request.preview?.turn ?? 0))) : (conversation?.learnerTurns ?? 0);
  const prompt = assemblePrompt({ step, band: identity.band, a11y: identity.a11y, history, learnerMessage: cleanText, learnerTurnsSoFar });
  return go({ ...state, history, prompt });
};

// ───────────────────────────── Stage 8: model call ─────────────────────────────

const modelStage: Stage = async (state, deps) => {
  const { ctx, prompt } = state;
  if (!prompt) throw new Error("model stage reached without a prompt");
  const generation = await deps.gateway.generate(ctx, { alias: COACH_ROUTE_ALIAS, instructions: prompt.instructions, messages: prompt.messages, maxOutputTokens: MAX_OUTPUT_TOKENS });
  return go({ ...state, generations: [...state.generations, generation] });
};

// ───────────────────────────── Stage 9: output moderation ─────────────────────────────

type OutputCheck = { ok: true; text: string; verdict: ModerationVerdict } | { ok: false; verdict: ModerationVerdict | null; leakReasons: string[]; hadSecret: boolean; empty: boolean };

async function checkOutput(text: string, state: State, deps: CoachDeps): Promise<OutputCheck> {
  const { identity, step } = state;
  if (!identity || !step) throw new Error("output check reached without identity or step");
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, verdict: null, leakReasons: [], hadSecret: false, empty: true };
  // The same classifiers as the input, pointed at the model's words.
  const verdict = await deps.moderator.moderate({ text: trimmed, direction: "output", band: identity.band });
  // The solution, a whole file of code, finished writing — or Coach's own instructions and the author's private notes.
  const leak = detectLeak({ reply: trimmed, referenceSolution: step.step.referenceSolution, confidential: state.prompt?.confidential });
  // A reply must never carry anything shaped like a password, key, code or card number.
  const hadSecret = redactInput(trimmed, { now: state.ctx.now }).refused;
  if (verdict.action !== "allow" || leak.leak || hadSecret) return { ok: false, verdict, leakReasons: leak.reasons, hadSecret, empty: false };
  return { ok: true, text: trimmed, verdict };
}

const outputModerationStage: Stage = async (state, deps) => {
  const { ctx, identity, step, cleanText, prompt } = state;
  const first = state.generations[state.generations.length - 1];
  if (!identity || !step || cleanText === undefined || !prompt || !first) throw new Error("output stage reached without a generation");

  // Second layer of crisis detection: the model flags a disclosure the rules did not catch. Its
  // words are thrown away; the learner gets the fixed script.
  if (first.text.includes(CRISIS_SENTINEL)) return halt(state, crisisTerminal(MODEL_FLAG));

  const firstCheck = await checkOutput(first.text, state, deps);
  if (firstCheck.ok) return go({ ...state, reply: firstCheck.text, outputVerdict: firstCheck.verdict });

  // Blocked: regenerate once with a corrective instruction, then check again from scratch.
  const corrective = correctiveReasons({ leakReasons: firstCheck.leakReasons, moderationCategory: firstCheck.verdict?.category ?? null, hadSecret: firstCheck.hadSecret, empty: firstCheck.empty });
  const retryPrompt = assemblePrompt({
    step,
    band: identity.band,
    a11y: identity.a11y,
    history: state.history,
    learnerMessage: cleanText,
    learnerTurnsSoFar: prompt.rung - 1,
    corrective,
  });
  const second = await deps.gateway.generate(ctx, { alias: COACH_ROUTE_ALIAS, instructions: retryPrompt.instructions, messages: retryPrompt.messages, maxOutputTokens: MAX_OUTPUT_TOKENS });
  if (second.text.includes(CRISIS_SENTINEL)) return halt({ ...state, generations: [...state.generations, second], regenerated: true }, crisisTerminal(MODEL_FLAG));
  const retried: State = { ...state, generations: [...state.generations, second], regenerated: true, leakReasons: firstCheck.leakReasons, outputVerdict: firstCheck.verdict ?? undefined };
  const secondCheck = await checkOutput(second.text, retried, deps);
  if (secondCheck.ok) return go({ ...retried, reply: secondCheck.text, outputVerdict: secondCheck.verdict });

  return halt(
    { ...retried, leakReasons: [...new Set([...firstCheck.leakReasons, ...secondCheck.leakReasons])], outputVerdict: secondCheck.verdict ?? firstCheck.verdict ?? undefined },
    refusal("output_blocked", "blocked_output", COACH_COPY.outputBlocked),
  );
};

const MODEL_FLAG: CrisisSignal = { severity: "high", trigger: "crisis_classifier", categories: ["model_flag"] };

const STAGES: Array<{ name: CoachStage; run: Stage }> = [
  { name: "authn_authz", run: authStage },
  { name: "capability", run: capabilityStage },
  { name: "rate_limits", run: rateLimitStage },
  { name: "credit_reservation", run: creditStage },
  { name: "input_sanitisation", run: sanitiseStage },
  { name: "input_moderation", run: inputModerationStage },
  { name: "prompt_assembly", run: promptStage },
  { name: "model_call", run: modelStage },
  { name: "output_moderation", run: outputModerationStage },
];
/** Stages before the input has been moderated. A stop here triggers the crisis safety net. */
const BEFORE_MODERATION = new Set<CoachStage>(["authn_authz", "capability", "rate_limits", "credit_reservation", "input_sanitisation", "input_moderation"]);

// ───────────────────────────── Stages 10 and 11: commit, record, return ─────────────────────────────

const sum = (items: GatewayResult[], pick: (g: GatewayResult) => number): number => items.reduce((total, g) => total + pick(g), 0);

/** Opens the safeguarding case in the background, with retries. Never throws and never delays the reply. */
function openCaseInBackground(state: State, deps: CoachDeps, input: { severity: "critical" | "high"; trigger: "crisis_classifier" | "abuse_disclosure" | "exploitation" | "grooming"; categories: string[]; detail: string }): Promise<boolean> {
  const { ctx, identity, conversation } = state;
  if (!identity || identity.mode !== "live") return Promise.resolve(false);
  const learnerId = identity.userId;
  const sourceId = conversation?.id ?? null;
  return (async () => {
    try {
      // Flood guard on the alert channel only. If the limiter itself fails, open the case anyway.
      const allowed = await deps.rateLimit
        .hit(ctx, "coach.crisis_case", { scope: "user", id: learnerId, ...CRISIS_CASE_LIMIT })
        .then((hit) => hit.allowed)
        .catch(() => true);
      if (!allowed && input.severity !== "critical") {
        deps.log.warn("coach.crisis.case_suppressed", { learnerId, conversationId: sourceId, requestId: ctx.requestId, reason: "several cases already opened for this learner in the last ten minutes" });
        return false;
      }
      const outcome = await openCaseWithRetry(
        () =>
          deps.safeguarding.openCase(ctx, {
            learnerId,
            severity: input.severity,
            trigger: input.trigger,
            // Short, factual and non-identifying. The learner's words go into the encrypted notes.
            summary: `Coach showed the crisis script (${CRISIS_SCRIPT_VERSION}). Signals: ${input.categories.join(", ")}.`,
            sourceType: "tutor_conversation",
            sourceId,
            detail: input.detail,
          }),
        {
          sleep: deps.clock.sleep,
          onFailure: (error, attempt) => deps.log.error("coach.crisis.case_open_failed", error, { attempt, learnerId, conversationId: sourceId, severity: input.severity, requestId: ctx.requestId }),
        },
      );
      if (outcome.caseId === null) {
        deps.log.error("coach.crisis.CASE_NOT_OPENED", outcome.error, {
          learnerId,
          conversationId: sourceId,
          severity: input.severity,
          trigger: input.trigger,
          attempts: outcome.attempts,
          requestId: ctx.requestId,
          action: "A safeguarding case could not be opened after a crisis script was shown. The DSL must review this learner's flagged Coach conversation now.",
        });
        return false;
      }
      if (sourceId) {
        await deps.store.linkCase(ctx, sourceId, outcome.caseId).catch((error: unknown) => deps.log.error("coach.crisis.link_case_failed", error, { conversationId: sourceId, caseId: outcome.caseId }));
      }
      return true;
    } catch (error) {
      deps.log.error("coach.crisis.CASE_NOT_OPENED", error, { learnerId, conversationId: sourceId, requestId: ctx.requestId });
      return false;
    }
  })();
}

async function finalise(state: State, terminal: Terminal, stage: CoachStage, deps: CoachDeps): Promise<CoachResult> {
  const { ctx, identity, conversation } = state;
  const live = identity?.mode === "live";
  const isReply = terminal.kind === "reply";
  const isCrisis = terminal.kind === "crisis";
  const cost = sum(state.generations, (g) => g.costMillipence);
  const last = state.generations[state.generations.length - 1];
  let creditsCharged = 0;
  let energy: EnergyView | null = state.energy ?? null;
  let recordFailed = false;

  // Money was spent whenever a model was called, whatever the learner ended up seeing.
  if (state.generations.length > 0) {
    await deps.spend.record(ctx, { feature: "tutor", costMillipence: cost }).catch((error: unknown) => deps.log.error("coach.spend.record_failed", error, { requestId: ctx.requestId }));
  }
  if (state.lease) await state.lease.release().catch((error: unknown) => deps.log.warn("coach.concurrency.release_failed", { error: String(error) }));

  // Stage 10: metadata (never message text), content only where retention allows, and the charge.
  const keepContent = live && (isReply || terminal.flagContent === true);
  const recordable = identity !== undefined && terminal.outcome !== "rate_limited";
  const flagged = terminal.flagContent === true;
  const turn = async (charged: number): Promise<TurnRecord | null> => {
    if (!recordable) return null;
    const userText = state.cleanText ?? scrubForStorage(state.request.message.trim());
    const extendedRetention = keepContent && !flagged ? await deps.people.hasConsent(ctx, identity.userId, "tutor_history_retention").catch(() => false) : false;
    return {
      aiRequestId: state.aiRequestId,
      userId: identity.userId,
      familyId: identity.familyId,
      isPreview: identity.mode === "preview",
      outcome: terminal.outcome,
      errorCode: terminal.errorCode ?? (terminal.kind === "denied" || terminal.kind === "refusal" ? terminal.code : null),
      step: state.step ? { courseId: state.step.courseId, stepId: state.step.stepId, enrolmentId: state.step.enrolmentId, courseTitle: state.step.courseTitle, stepTitle: state.step.step.title } : null,
      conversation: live && conversation && (keepContent || !conversation.isNew) ? { id: conversation.id, isNew: conversation.isNew } : null,
      moderation:
        state.inputVerdict || state.outputVerdict || terminal.crisis
          ? {
              input: state.inputVerdict?.summary ?? null,
              output: state.outputVerdict?.summary ?? null,
              leak: state.leakReasons,
              crisis: terminal.crisis ? { severity: terminal.crisis.severity, categories: terminal.crisis.categories } : null,
              moderator: state.inputVerdict?.moderator ?? null,
              stage,
            }
          : null,
      routeAlias: last?.routeAlias ?? null,
      providerKey: last?.providerKey ?? null,
      model: last?.model ?? null,
      promptVersion: state.prompt ? COACH_PROMPT_VERSION : null,
      inputTokens: sum(state.generations, (g) => g.inputTokens),
      outputTokens: sum(state.generations, (g) => g.outputTokens),
      costMillipence: cost,
      creditsCharged: charged,
      latencyMs: Math.max(0, Math.round(deps.clock.nowMs() - state.startedMs)),
      content: keepContent ? { user: userText, userRedacted: state.redacted, assistant: isReply ? (state.reply ?? null) : null } : null,
      flagged,
      extendedRetention,
    };
  };
  const release = async (reason: string): Promise<void> => {
    if (!state.reservation) return;
    await deps.credits.release(ctx, { reservationId: state.reservation.id, reason }).catch((error: unknown) => deps.log.error("coach.credits.settle_failed", error, { reservationId: state.reservation?.id, requestId: ctx.requestId }));
  };

  if (isReply) {
    // An approved reply: the record and the charge are written together or not at all, so a
    // learner is never charged for an answer they did not get, and never gets one for nothing.
    const planned =
      state.reservation && state.settings
        ? creditsToCommit(state.reservation.amount, cost, { creditValuePence: state.settings.creditValuePence, creditMargin: state.settings.creditMargin, minimumCredits: state.minimumCredits ?? 1 })
        : 0;
    try {
      const record = await turn(planned);
      await deps.atomic(ctx, async (tx) => {
        if (record) await deps.store.record(tx, record);
        if (state.reservation) await deps.credits.commit(tx, { reservationId: state.reservation.id, amount: planned, aiRequestId: state.aiRequestId });
      });
      creditsCharged = planned;
    } catch (error) {
      deps.log.error("coach.record_failed", error, { requestId: ctx.requestId, outcome: terminal.outcome });
      recordFailed = true;
      await release("record_failed");
    }
  } else {
    // Anything else is free: the whole hold goes back, then the turn is recorded.
    await release(terminal.code);
    try {
      const record = await turn(0);
      if (record) await deps.store.record(ctx, record);
    } catch (error) {
      deps.log.error("coach.record_failed", error, { requestId: ctx.requestId, outcome: terminal.outcome });
      recordFailed = true;
    }
  }

  // A reply that could not be accounted for is not shown: fail closed. A crisis script is always shown.
  const shown = isReply && recordFailed ? faultTerminal("record_failed") : terminal;

  // Background: the safeguarding case. It must not delay the script.
  let settled: Promise<void> = Promise.resolve();
  let caseOpened = false;
  if (live && (shown.crisis || shown.safeguarding)) {
    const signal = shown.crisis ?? shown.safeguarding;
    if (signal) {
      settled = openCaseInBackground(state, deps, {
        severity: signal.severity,
        trigger: signal.trigger,
        categories: signal.categories,
        detail: state.cleanText ?? scrubForStorage(state.request.message.trim()),
      }).then((opened) => {
        caseOpened = opened;
      });
    }
  }

  if (live && state.entitlement && identity) {
    energy = await deps.credits.energy(ctx, identity.userId, state.entitlement).catch(() => energy);
  }

  // Stage 11: the result. The route streams `message` to the browser.
  const script = isCrisis ? getCrisisScript((error) => deps.log.error("coach.crisis.script_load_failed", error)) : null;
  const preview = identity?.mode === "preview";
  const result: CoachResult = {
    kind: shown.kind,
    code: shown.code,
    outcome: shown.outcome,
    status: shown.status,
    message: script ? renderCrisisText(script) : shown.kind === "reply" ? (state.reply ?? "") : shown.message,
    aiGenerated: shown.kind === "reply",
    label: shown.kind === "reply" ? AI_LABEL : FIXED_LABEL,
    notices: shown.kind === "denied" ? [] : [...state.notices, ...(isCrisis && preview ? [COACH_COPY.previewCrisisNote] : [])],
    // A reply continues its conversation, and so does a refusal part-way through one (the hint
    // ladder keeps its place). After a crisis turn, or anything else that flags the conversation,
    // it is closed to the learner and the next message starts a new one.
    conversationId: live && conversation && (shown.kind === "reply" || (shown.kind === "refusal" && !conversation.isNew && !flagged)) ? conversation.id : null,
    requestId: recordable && !recordFailed ? state.aiRequestId : null,
    crisis: script,
    energy: live ? energy : null,
    preview: preview === true,
    meta: {
      stage,
      modelCalls: state.generations.length,
      moderation: state.inputVerdict?.summary ?? null,
      leakReasons: state.leakReasons,
      regenerated: state.regenerated,
      creditsCharged: shown.kind === "reply" ? creditsCharged : 0,
      costMillipence: cost,
      get caseOpened() {
        return caseOpened;
      },
    },
    settled,
  };
  return result;
}

// ───────────────────────────── The proxy ─────────────────────────────

export type CoachProxy = { chat(ctx: Ctx, request: CoachRequest): Promise<CoachResult> };

export function createCoachProxy(deps: CoachDeps): CoachProxy {
  return {
    async chat(ctx, request) {
      let state: State = {
        ctx,
        request,
        aiRequestId: randomUUID(),
        startedMs: deps.clock.nowMs(),
        redacted: false,
        notices: [],
        history: [],
        generations: [],
        leakReasons: [],
        regenerated: false,
      };
      let terminal: Terminal | undefined;
      let stage: CoachStage = "authn_authz";

      for (const { name, run } of STAGES) {
        stage = name;
        try {
          const outcome = await run(state, deps);
          state = outcome.state;
          if (!outcome.continue) {
            terminal = outcome.result;
            break;
          }
        } catch (error) {
          // FAIL CLOSED: a stage that throws ends the turn with a safe message. Nothing after it runs.
          deps.log.error("coach.stage_failed", error, { stage: name, requestId: ctx.requestId });
          terminal = faultTerminal(`${name}_failed`);
          break;
        }
      }

      if (!terminal) {
        stage = "commit_and_record";
        terminal = state.reply ? { kind: "reply", code: "ok", outcome: "ok", status: 200, message: state.reply } : faultTerminal("no_reply");
      } else if (terminal.kind !== "crisis" && state.identity && BEFORE_MODERATION.has(stage)) {
        // The crisis safety net: someone we were about to turn away gets the script if they need it.
        try {
          const signal = detectCrisis(request.message, state.identity.band);
          if (signal) terminal = crisisTerminal(signal);
        } catch (error) {
          deps.log.error("coach.crisis.safety_net_failed", error, { requestId: ctx.requestId });
        }
      }

      try {
        return await finalise(state, terminal, stage, deps);
      } catch (error) {
        // Recording failed in a way `finalise` did not expect. The script, if any, is still shown.
        deps.log.error("coach.finalise_failed", error, { requestId: ctx.requestId });
        if (state.lease) await state.lease.release().catch(() => undefined);
        if (state.reservation) await deps.credits.release(ctx, { reservationId: state.reservation.id, reason: "finalise_failed" }).catch(() => undefined);
        const crisis = terminal.kind === "crisis";
        // Even now, a crisis turn still raises the alarm.
        const settled =
          crisis && terminal.crisis
            ? openCaseInBackground(state, deps, { ...terminal.crisis, detail: scrubForStorage(request.message.trim()) }).then(() => undefined)
            : Promise.resolve();
        const script = crisis ? getCrisisScript() : null;
        const fault = faultTerminal("finalise_failed");
        return {
          kind: crisis ? "crisis" : fault.kind,
          code: crisis ? "crisis" : fault.code,
          outcome: crisis ? "crisis" : fault.outcome,
          status: crisis ? 200 : fault.status,
          message: script ? renderCrisisText(script) : fault.message,
          aiGenerated: false,
          label: FIXED_LABEL,
          notices: [],
          conversationId: null,
          requestId: null,
          crisis: script,
          energy: null,
          preview: state.identity?.mode === "preview",
          meta: { stage, modelCalls: state.generations.length, moderation: null, leakReasons: [], regenerated: state.regenerated, creditsCharged: 0, costMillipence: 0, caseOpened: false },
          settled,
        };
      }
    },
  };
}

/**
 * Splits approved text into small chunks for Server-Sent Events. Words are kept whole so that a
 * screen reader hears sensible fragments.
 */
export function chunkForStreaming(text: string, size = 48): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of text.split(/(\s+)/)) {
    if (current.length + piece.length > size && current.length > 0) {
      chunks.push(current);
      current = "";
    }
    current += piece;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
