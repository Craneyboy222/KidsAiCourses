/**
 * The player's progress, kept outside React so it can be reasoned about (and tested) on its own.
 *
 * Two sessions share one interface:
 *  - `LiveSession`: a learner on their own enrolment. Changes are autosaved to our API: debounced,
 *    retried with a back-off, sent at once when the tab is hidden, and never dropped. The server
 *    decides what is complete. When the server says the daily cap or quiet hours have arrived, the
 *    work that was in hand has already been saved by that same request ("save first, then stop").
 *  - `PreviewSession`: staff looking at a draft. Progress lives in this browser tab only
 *    (sessionStorage). Nothing is sent anywhere except a quiz to be marked, and that writes nothing.
 */
import type { CompletionRule, StepType } from "@/content/schema";
import { canSkipStep, evaluateCompletion, isEvidenceRule, isWrittenStep, type StepState } from "@/lib/learning/completion";
import type { QuizAnswers, QuizResult } from "@/lib/learning/quiz-grading";
import { mergeStepData, readStepData, type StepData } from "@/lib/learning/step-data";

export type StopReason = { reason: "time_cap" | "quiet_hours" | "paused" | "consent" | "not_active"; message: string };
export type SaveStatus = "idle" | "saving" | "saved" | "retrying" | "failed";
export type QuizOutcome = (QuizResult & { attemptNumber: number }) | { error: string };
export type ActionResult = { ok: true } | { ok: false; message: string };

export type StepMeta = {
  key: string;
  type: StepType;
  rule: CompletionRule;
  threshold: number | null;
  hintCount: number;
  guideStepIds: string[];
  disabled: boolean;
  /** False when no video file (with captions) can be played: the step must not hold the learner back. */
  videoPlayable: boolean;
};

export type StepSnapshot = {
  status: StepState;
  data: StepData;
  notes: string;
  response: string;
  quiz: { attempts: number; passed: boolean; bestScore: number | null } | null;
};

export type SessionState = {
  current: StepSnapshot;
  /** Status of every step in the course, by key. */
  statuses: Record<string, StepState>;
  saveStatus: SaveStatus;
  /** Set when learning has to stop. Work in hand has been saved first. */
  stopped: StopReason | null;
};

export type StepPatch = { data?: Partial<StepData>; notes?: string; response?: string };

export interface PlayerSession {
  subscribe(listener: () => void): () => void;
  getState(): SessionState;
  getServerState(): SessionState;
  /** Attach to the page (listeners, the "opened" call). Safe to call again after `dispose`. */
  start(): void;
  dispose(): void;
  update(patch: StepPatch): void;
  complete(): Promise<ActionResult>;
  skip(): Promise<ActionResult>;
  submitQuiz(answers: QuizAnswers): Promise<QuizOutcome>;
  flush(): Promise<void>;
  stop(reason: StopReason): void;
}

export const EMPTY_STEP: StepSnapshot = { status: "not_started", data: {}, notes: "", response: "", quiz: null };

export const SAVE_DELAY_MS = 900;
export const RETRY_DELAYS_MS = [1500, 4000, 10_000] as const;
const OFFLINE_MESSAGE = "We couldn't reach the server. Check your connection: your work is kept here and we'll keep trying.";
const GENERIC_MESSAGE = "Something went wrong on our side. Nothing was lost. Try again in a moment.";
const LAST_STEP_MESSAGE = "The last step can't be skipped. Send in your work when you're ready.";

const STOP_CODES: Record<string, StopReason["reason"]> = { time_cap_reached: "time_cap", quiet_hours: "quiet_hours", paused: "paused", consent_required: "consent" };

function judge(step: StepMeta, snapshot: StepSnapshot) {
  return evaluateCompletion(
    { type: step.type, rule: step.rule, threshold: step.threshold, guideStepIds: step.guideStepIds },
    {
      watchedFraction: snapshot.data.watchedFraction,
      transcriptRead: snapshot.data.transcriptRead,
      ticked: snapshot.data.ticked,
      guideTicks: snapshot.data.guideTicks,
      responseLength: isWrittenStep(step.type) ? snapshot.response.trim().length : 0,
      quizPassed: snapshot.quiz?.passed === true,
      evidence: snapshot.data.evidence ?? "none",
    },
  );
}

function withPatch(step: StepMeta, before: StepSnapshot, patch: StepPatch): StepSnapshot {
  return {
    ...before,
    status: before.status === "not_started" ? "in_progress" : before.status,
    data: patch.data ? mergeStepData(before.data, { ...before.data, ...patch.data }, { hintCount: step.hintCount, guideStepIds: step.guideStepIds }) : before.data,
    notes: patch.notes ?? before.notes,
    response: patch.response ?? before.response,
  };
}

function withQuizResult(before: StepSnapshot, result: QuizResult): StepSnapshot {
  const quiz = { attempts: (before.quiz?.attempts ?? 0) + 1, passed: (before.quiz?.passed ?? false) || result.passed, bestScore: Math.max(before.quiz?.bestScore ?? 0, result.score) };
  return { ...before, quiz, status: result.passed || before.status === "completed" ? "completed" : "in_progress" };
}

abstract class BaseSession {
  protected state: SessionState;
  private readonly initial: SessionState;
  private readonly listeners = new Set<() => void>();

  constructor(
    protected readonly step: StepMeta,
    initial: SessionState,
  ) {
    this.state = initial;
    this.initial = initial;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getState = (): SessionState => this.state;
  getServerState = (): SessionState => this.initial;

  protected set(patch: Partial<SessionState>): void {
    const next = { ...this.state, ...patch };
    if (patch.current) next.statuses = this.state.statuses[this.step.key] === patch.current.status ? next.statuses : { ...next.statuses, [this.step.key]: patch.current.status };
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  stop = (reason: StopReason): void => {
    if (!this.state.stopped) this.set({ stopped: reason });
  };
}

// ───────────────────────────── Live ─────────────────────────────

type SaveResponse = {
  status: StepState;
  data: StepData;
  completion: { complete: boolean; message?: string } | null;
  stopped: { reason: "time_cap" | "quiet_hours"; message: string } | null;
};

type SendResult = { ok: true; result: SaveResponse } | { ok: false; code: string; message: string; retry: boolean };

async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.message === "string") return { code: String(body.error.code ?? "error"), message: body.error.message };
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return { code: "error", message: GENERIC_MESSAGE };
}

export type LiveSessionOptions = {
  enrolmentId: string;
  step: StepMeta;
  initial: { statuses: Record<string, StepState>; current: StepSnapshot };
  /** For tests. Defaults to the browser's `fetch`. */
  fetchImpl?: typeof fetch;
};

export class LiveSession extends BaseSession implements PlayerSession {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private pending: StepPatch | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private attempt = 0;
  private started = false;

  constructor(options: LiveSessionOptions) {
    super(options.step, { current: options.initial.current, statuses: options.initial.statuses, saveStatus: "idle", stopped: null });
    this.endpoint = `/api/v1/enrolments/${options.enrolmentId}/steps/${encodeURIComponent(options.step.key)}`;
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  start = (): void => {
    if (this.started) return;
    this.started = true;
    document.addEventListener("visibilitychange", this.onHide);
    window.addEventListener("pagehide", this.onHide);
    window.addEventListener("online", this.onOnline);
    // Say "opened" so the resume point follows the learner. Rendering a page never does this.
    if (!this.step.disabled) {
      void this.send({ intent: "open" }).then((outcome) => {
        if (!this.started) return;
        if (outcome.ok) this.settle(outcome.result);
        else this.stopFor(outcome);
      });
    }
  };

  dispose = (): void => {
    if (!this.started) return;
    this.started = false;
    document.removeEventListener("visibilitychange", this.onHide);
    window.removeEventListener("pagehide", this.onHide);
    window.removeEventListener("online", this.onOnline);
    // Leaving the step: whatever has not been sent yet goes now, and outlives the page.
    this.sendPendingNow();
  };

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private onOnline = (): void => {
    void this.flush();
  };

  /** The tab is being hidden or closed: send what is waiting straight away, in a request that survives the page. */
  private onHide = (): void => {
    if (document.visibilityState === "hidden") this.sendPendingNow();
  };

  private sendPendingNow(): void {
    const body = this.pending;
    if (!body) return;
    this.pending = null;
    this.clearTimer();
    void this.send({ intent: "save", ...body }, true).then((outcome) => {
      if (outcome.ok) {
        if (this.started) {
          this.settle(outcome.result);
          this.set({ saveStatus: "saved" });
        }
      } else if (outcome.retry) this.requeue(body);
    });
  }

  private requeue(body: StepPatch): void {
    // Newer edits win over the ones that failed to send.
    this.pending = { ...body, ...(this.pending ?? {}), data: body.data || this.pending?.data ? { ...(body.data ?? {}), ...(this.pending?.data ?? {}) } : undefined };
  }

  private async send(body: StepPatch & { intent: "open" | "save" | "complete" | "skip" }, keepalive = false): Promise<SendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive, credentials: "same-origin" });
    } catch {
      return { ok: false, code: "network", message: OFFLINE_MESSAGE, retry: true };
    }
    if (!response.ok) return { ok: false, ...(await readError(response)), retry: response.status >= 500 || response.status === 429 };
    return { ok: true, result: (await response.json()) as SaveResponse };
  }

  private settle(result: SaveResponse): void {
    // Anything typed while the request was in the air is newer than what came back.
    this.set({ current: { ...this.state.current, status: result.status, data: { ...result.data, ...(this.pending?.data ?? {}) } } });
    if (result.stopped) this.stop(result.stopped);
  }

  private stopFor(outcome: { code: string; message: string }): boolean {
    const reason = STOP_CODES[outcome.code];
    if (reason) this.stop({ reason, message: outcome.message });
    return reason !== undefined;
  }

  update = (patch: StepPatch): void => {
    if (this.step.disabled) return;
    this.set({ current: withPatch(this.step, this.state.current, patch), saveStatus: "saving" });
    this.pending = { ...(this.pending ?? {}), ...patch, data: patch.data || this.pending?.data ? { ...(this.pending?.data ?? {}), ...(patch.data ?? {}) } : undefined };
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  };

  flush = async (): Promise<void> => {
    this.clearTimer();
    if (this.inFlight) await this.inFlight;
    const body = this.pending;
    if (!body) return;
    this.pending = null;
    this.set({ saveStatus: "saving" });
    const work = (async () => {
      const outcome = await this.send({ intent: "save", ...body });
      if (outcome.ok) {
        this.attempt = 0;
        this.settle(outcome.result);
        this.set({ saveStatus: this.pending ? "saving" : "saved" });
        return;
      }
      if (this.stopFor(outcome) || !outcome.retry) {
        // The server understood and said no (course closed, signed out, too long). Trying again will not help.
        this.set({ saveStatus: "failed" });
        return;
      }
      this.requeue(body);
      const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)] ?? 10_000;
      this.attempt += 1;
      this.set({ saveStatus: "retrying" });
      this.clearTimer();
      this.timer = setTimeout(() => void this.flush(), delay);
    })();
    this.inFlight = work;
    try {
      await work;
    } finally {
      this.inFlight = null;
    }
  };

  complete = async (): Promise<ActionResult> => {
    if (this.step.disabled || this.state.current.status === "completed") return { ok: true };
    await this.flush();
    if (this.state.stopped) return { ok: false, message: this.state.stopped.message };
    const outcome = await this.send({ intent: "complete" });
    if (!outcome.ok) {
      this.stopFor(outcome);
      return { ok: false, message: outcome.message };
    }
    this.settle(outcome.result);
    if (outcome.result.stopped) return { ok: false, message: outcome.result.stopped.message };
    if (outcome.result.status === "completed") return { ok: true };
    return { ok: false, message: outcome.result.completion?.message ?? "This step isn't finished yet." };
  };

  skip = async (): Promise<ActionResult> => {
    if (this.step.disabled || this.state.current.status === "completed") return { ok: true };
    if (!canSkipStep(this.step.type)) return { ok: false, message: LAST_STEP_MESSAGE };
    await this.flush();
    const outcome = await this.send({ intent: "skip" });
    if (!outcome.ok) {
      this.stopFor(outcome);
      return { ok: false, message: outcome.message };
    }
    this.settle(outcome.result);
    return outcome.result.stopped ? { ok: false, message: outcome.result.stopped.message } : { ok: true };
  };

  submitQuiz = async (answers: QuizAnswers): Promise<QuizOutcome> => {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/quiz-attempts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }), credentials: "same-origin" });
    } catch {
      return { error: "We couldn't reach the server. Check your connection, then try again. Your answers are still here." };
    }
    if (!response.ok) {
      const error = await readError(response);
      this.stopFor(error);
      return { error: error.message };
    }
    const result = (await response.json()) as QuizResult & { attemptNumber: number };
    this.set({ current: withQuizResult(this.state.current, result) });
    return result;
  };
}

// ───────────────────────────── Preview ─────────────────────────────

export const previewStorageKey = (versionId: string): string => `preview-progress:${versionId}`;

export type PreviewSessionOptions = {
  versionId: string;
  step: StepMeta;
  /** Every step key in course order. */
  order: readonly string[];
  /** Marks a quiz on the server without writing anything. */
  grade?: (versionId: string, stepKey: string, answers: QuizAnswers) => Promise<QuizOutcome>;
  /** For tests. Defaults to this tab's `sessionStorage`. */
  storage?: Pick<Storage, "getItem" | "setItem">;
};

type PreviewStore = Record<string, StepSnapshot>;

export class PreviewSession extends BaseSession implements PlayerSession {
  private readonly options: PreviewSessionOptions;

  constructor(options: PreviewSessionOptions) {
    super(options.step, { current: EMPTY_STEP, statuses: {}, saveStatus: "idle", stopped: null });
    this.options = options;
  }

  private storage(): Pick<Storage, "getItem" | "setItem"> | null {
    if (this.options.storage) return this.options.storage;
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  private read(): PreviewStore {
    try {
      const raw = this.storage()?.getItem(previewStorageKey(this.options.versionId));
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (typeof parsed !== "object" || parsed === null) return {};
      const out: PreviewStore = {};
      for (const [key, value] of Object.entries(parsed as Record<string, Partial<StepSnapshot> | null>)) {
        if (!value) continue;
        const status = value.status;
        out[key] = {
          status: status === "completed" || status === "skipped" || status === "in_progress" ? status : "not_started",
          data: readStepData(value.data),
          notes: typeof value.notes === "string" ? value.notes : "",
          response: typeof value.response === "string" ? value.response : "",
          quiz: value.quiz ? { attempts: Number(value.quiz.attempts) || 0, passed: value.quiz.passed === true, bestScore: typeof value.quiz.bestScore === "number" ? value.quiz.bestScore : null } : null,
        };
      }
      return out;
    } catch {
      return {};
    }
  }

  private write(next: StepSnapshot): void {
    const stored = this.read();
    stored[this.step.key] = next;
    try {
      this.storage()?.setItem(previewStorageKey(this.options.versionId), JSON.stringify(stored));
    } catch {
      // Private browsing or a full quota: the preview still works for this page.
    }
    this.set({ current: next, statuses: Object.fromEntries(this.options.order.map((key) => [key, stored[key]?.status ?? "not_started"])) });
  }

  start = (): void => {
    const mine = this.read()[this.step.key] ?? EMPTY_STEP;
    // A step counts as opened once it has been looked at, exactly as it does for a learner.
    this.write(mine.status === "not_started" ? { ...mine, status: "in_progress" } : mine);
  };

  dispose = (): void => {};
  flush = async (): Promise<void> => {};

  update = (patch: StepPatch): void => {
    if (!this.step.disabled) this.write(withPatch(this.step, this.state.current, patch));
  };

  complete = async (): Promise<ActionResult> => {
    const { current } = this.state;
    if (this.step.disabled || current.status === "completed") return { ok: true };
    const check = judge(this.step, current);
    const unplayable = !check.complete && check.code === "watch_more" && !this.step.videoPlayable;
    // Nothing real can be handed in from a preview, so an evidence step is simply walked through.
    if (check.complete || unplayable || isEvidenceRule(this.step.rule)) {
      this.write({ ...current, status: "completed" });
      return { ok: true };
    }
    return { ok: false, message: check.message };
  };

  skip = async (): Promise<ActionResult> => {
    const { current } = this.state;
    if (this.step.disabled || current.status === "completed") return { ok: true };
    if (!canSkipStep(this.step.type)) return { ok: false, message: LAST_STEP_MESSAGE };
    this.write({ ...current, status: "skipped" });
    return { ok: true };
  };

  submitQuiz = async (answers: QuizAnswers): Promise<QuizOutcome> => {
    if (!this.options.grade) return { error: "Quiz marking isn't available in this preview." };
    let outcome: QuizOutcome;
    try {
      outcome = await this.options.grade(this.options.versionId, this.step.key, answers);
    } catch {
      return { error: GENERIC_MESSAGE };
    }
    if (!("error" in outcome)) this.write(withQuizResult(this.state.current, outcome));
    return outcome;
  };
}
