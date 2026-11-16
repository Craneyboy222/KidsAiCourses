"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isPreview, type PlayerMode } from "@/components/course/types";
import type { CompletionRule, StepType } from "@/content/schema";
import { canSkipStep, evaluateCompletion, isEvidenceRule, isWrittenStep, type StepState } from "@/lib/learning/completion";
import type { QuizAnswers, QuizResult } from "@/lib/learning/quiz-grading";
import { mergeStepData, readStepData, type StepData } from "@/lib/learning/step-data";

/**
 * The player's state, shared by the small client islands on a step (video, ticks, notes, quiz,
 * hints, the Next button).
 *
 * Two back ends sit behind one interface:
 *  - live: a learner on their own enrolment. Changes are autosaved to our API (debounced, retried,
 *    flushed when the tab is hidden) and the server decides what is complete.
 *  - preview: staff looking at a draft. Progress lives in this browser tab only (sessionStorage).
 *    Nothing is sent anywhere except a quiz to be graded, and that writes nothing either.
 */

export type StopReason = { reason: "time_cap" | "quiet_hours" | "paused" | "consent" | "not_active"; message: string };

export type SaveStatus = "idle" | "saving" | "saved" | "retrying" | "failed";

export type QuizOutcome = (QuizResult & { attemptNumber: number }) | { error: string };

export type StepMeta = {
  key: string;
  type: StepType;
  rule: CompletionRule;
  threshold: number | null;
  hintCount: number;
  guideStepIds: string[];
  disabled: boolean;
  /** False when no video file can be played: the step must not hold the learner back. */
  videoPlayable: boolean;
};

export type StepSnapshot = {
  status: StepState;
  data: StepData;
  notes: string;
  response: string;
  quiz: { attempts: number; passed: boolean; bestScore: number | null } | null;
};

export type PlayerStore = {
  mode: PlayerMode;
  step: StepMeta;
  current: StepSnapshot;
  /** Status of every step in the course, by key. */
  statuses: Record<string, StepState>;
  saveStatus: SaveStatus;
  /** Set when learning has to stop (daily cap, quiet hours). Work in hand has been saved first. */
  stopped: StopReason | null;
  update(patch: { data?: Partial<StepData>; notes?: string; response?: string }): void;
  /** Asks for the step to be completed. Resolves with why not, in words for the learner. */
  complete(): Promise<{ ok: true } | { ok: false; message: string }>;
  skip(): Promise<{ ok: true } | { ok: false; message: string }>;
  submitQuiz(answers: QuizAnswers): Promise<QuizOutcome>;
  /** Sends anything waiting to be saved, now. */
  flush(): Promise<void>;
  stop(reason: StopReason): void;
  /** Coach lives in the frame; hints on the step can open it. */
  coachOpen: boolean;
  setCoachOpen(open: boolean): void;
};

const PlayerContext = createContext<PlayerStore | null>(null);

export function usePlayer(): PlayerStore {
  const store = use(PlayerContext);
  if (!store) throw new Error("usePlayer must be used inside <PlayerProvider>.");
  return store;
}

export type PlayerProviderProps = {
  mode: PlayerMode;
  step: StepMeta;
  /** Every step key in course order, with whether it is switched off. */
  order: { key: string; disabled: boolean }[];
  /** Live only: what the server knows. A preview starts empty and reads its own tab storage. */
  initial: { statuses: Record<string, StepState>; current: StepSnapshot } | null;
  /** Preview only: grades a quiz on the server without writing anything. */
  gradePreview?: (versionId: string, stepKey: string, answers: QuizAnswers) => Promise<QuizOutcome>;
  children: ReactNode;
};

const EMPTY: StepSnapshot = { status: "not_started", data: {}, notes: "", response: "", quiz: null };
const SAVE_DELAY_MS = 900;
const RETRY_DELAYS_MS = [1500, 4000, 10_000];
const OFFLINE_MESSAGE = "We couldn't reach the server. Check your connection: your work is kept here and we'll keep trying.";

type Pending = { notes?: string; response?: string; data?: Partial<StepData> };

type SaveResponse = {
  status: StepState;
  data: StepData;
  completion: { complete: boolean; message?: string } | null;
  stopped: { reason: "time_cap" | "quiet_hours"; message: string } | null;
};

const STOP_CODES: Record<string, StopReason["reason"]> = { time_cap_reached: "time_cap", quiet_hours: "quiet_hours", paused: "paused", consent_required: "consent" };

async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.message === "string") return { code: String(body.error.code ?? "error"), message: body.error.message };
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return { code: "error", message: "Something went wrong on our side. Nothing was lost. Try again in a moment." };
}

const previewKey = (versionId: string) => `preview-progress:${versionId}`;

type PreviewState = Record<string, StepSnapshot>;

function readPreview(versionId: string): PreviewState {
  try {
    const raw = window.sessionStorage.getItem(previewKey(versionId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: PreviewState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, Partial<StepSnapshot>>)) {
      const status = value.status;
      out[key] = {
        status: status === "completed" || status === "skipped" || status === "in_progress" ? status : "not_started",
        data: readStepData(value.data),
        notes: typeof value.notes === "string" ? value.notes : "",
        response: typeof value.response === "string" ? value.response : "",
        quiz: value.quiz && typeof value.quiz === "object" ? { attempts: Number(value.quiz.attempts) || 0, passed: value.quiz.passed === true, bestScore: typeof value.quiz.bestScore === "number" ? value.quiz.bestScore : null } : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writePreview(versionId: string, state: PreviewState): void {
  try {
    window.sessionStorage.setItem(previewKey(versionId), JSON.stringify(state));
  } catch {
    // Private browsing or a full quota: the preview still works for this page.
  }
}

export function PlayerProvider({ mode, step, order, initial, gradePreview, children }: PlayerProviderProps) {
  const preview = isPreview(mode);
  const [current, setCurrent] = useState<StepSnapshot>(initial?.current ?? EMPTY);
  const [statuses, setStatuses] = useState<Record<string, StepState>>(initial?.statuses ?? {});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [stopped, setStopped] = useState<StopReason | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);

  const currentRef = useRef(current);
  const pending = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const attempt = useRef(0);
  const stoppedRef = useRef(false);

  const apply = useCallback(
    (next: StepSnapshot) => {
      currentRef.current = next;
      setCurrent(next);
      setStatuses((before) => (before[step.key] === next.status ? before : { ...before, [step.key]: next.status }));
    },
    [step.key],
  );

  const stop = useCallback((reason: StopReason) => {
    stoppedRef.current = true;
    setStopped(reason);
  }, []);

  // ── Preview: this tab only ────────────────────────────────────────────────
  const versionId = preview ? mode.versionId : "";
  useEffect(() => {
    if (!preview) return;
    const stored = readPreview(versionId);
    const mine = stored[step.key] ?? EMPTY;
    // A step counts as opened once it has been looked at, exactly as it does for a learner.
    const opened: StepSnapshot = mine.status === "not_started" ? { ...mine, status: "in_progress" } : mine;
    stored[step.key] = opened;
    writePreview(versionId, stored);
    currentRef.current = opened;
    setCurrent(opened);
    setStatuses(Object.fromEntries(order.map((entry) => [entry.key, stored[entry.key]?.status ?? "not_started"])));
  }, [preview, versionId, step.key, order]);

  const savePreview = useCallback(
    (next: StepSnapshot) => {
      const stored = readPreview(versionId);
      stored[step.key] = next;
      writePreview(versionId, stored);
      apply(next);
    },
    [apply, step.key, versionId],
  );

  // ── Live: autosave to our own API ─────────────────────────────────────────
  const endpoint = !preview ? `/api/v1/enrolments/${mode.enrolmentId}/steps/${encodeURIComponent(step.key)}` : "";

  const send = useCallback(
    async (body: Pending & { intent: "open" | "save" | "complete" | "skip" }, options: { keepalive?: boolean } = {}): Promise<{ ok: true; result: SaveResponse } | { ok: false; code: string; message: string; network: boolean }> => {
      let response: Response;
      try {
        response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: options.keepalive, credentials: "same-origin" });
      } catch {
        return { ok: false, code: "network", message: OFFLINE_MESSAGE, network: true };
      }
      if (!response.ok) {
        const error = await readError(response);
        return { ok: false, ...error, network: response.status >= 500 };
      }
      return { ok: true, result: (await response.json()) as SaveResponse };
    },
    [endpoint],
  );

  const settle = useCallback(
    (result: SaveResponse) => {
      apply({ ...currentRef.current, status: result.status, data: { ...result.data, ...(pending.current?.data ?? {}) } });
      if (result.stopped) stop(result.stopped);
    },
    [apply, stop],
  );

  const flushLive = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) await inFlight.current;
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    setSaveStatus("saving");
    const work = (async () => {
      const outcome = await send({ intent: "save", ...body });
      if (outcome.ok) {
        attempt.current = 0;
        settle(outcome.result);
        setSaveStatus("saved");
        return;
      }
      const stopCode = STOP_CODES[outcome.code];
      if (stopCode) {
        stop({ reason: stopCode, message: outcome.message });
        setSaveStatus("failed");
        return;
      }
      if (!outcome.network) {
        // The server understood and said no (too long, signed out, course closed). Retrying will not help.
        setSaveStatus("failed");
        return;
      }
      // Put the unsent changes back (newer edits win) and try again shortly.
      pending.current = { ...body, ...(pending.current ?? {}), data: { ...body.data, ...(pending.current?.data ?? {}) } };
      const delay = RETRY_DELAYS_MS[Math.min(attempt.current, RETRY_DELAYS_MS.length - 1)] ?? 10_000;
      attempt.current += 1;
      setSaveStatus("retrying");
      timer.current = setTimeout(() => void flushRef.current(), delay);
    })();
    inFlight.current = work;
    await work;
    inFlight.current = null;
  }, [send, settle, stop]);

  const flushRef = useRef(flushLive);
  useEffect(() => {
    flushRef.current = flushLive;
  }, [flushLive]);

  // Say "opened" once, so the resume point follows the learner. Rendering a page never does this.
  useEffect(() => {
    if (preview || step.disabled) return;
    let cancelled = false;
    void send({ intent: "open" }).then((outcome) => {
      if (cancelled) return;
      if (outcome.ok) settle(outcome.result);
      else if (STOP_CODES[outcome.code]) stop({ reason: STOP_CODES[outcome.code] ?? "paused", message: outcome.message });
    });
    return () => {
      cancelled = true;
    };
  }, [preview, send, settle, step.disabled, stop]);

  // Never lose work: save when the tab is hidden or closed, and again when the connection returns.
  useEffect(() => {
    if (preview) return;
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      const body = pending.current;
      if (!body) return;
      pending.current = null;
      if (timer.current) clearTimeout(timer.current);
      void send({ intent: "save", ...body }, { keepalive: true }).then((outcome) => {
        if (!outcome.ok && outcome.network) pending.current = { ...body, ...(pending.current ?? {}) };
      });
    };
    const onOnline = () => void flushRef.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("online", onOnline);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [preview, send]);

  // ── The shared interface ─────────────────────────────────────────────────
  const limits = useMemo(() => ({ hintCount: step.hintCount, guideStepIds: step.guideStepIds }), [step.hintCount, step.guideStepIds]);

  const update = useCallback<PlayerStore["update"]>(
    (patch) => {
      if (step.disabled) return;
      const before = currentRef.current;
      const next: StepSnapshot = {
        ...before,
        status: before.status === "not_started" ? "in_progress" : before.status,
        data: patch.data ? mergeStepData(before.data, { ...before.data, ...patch.data }, limits) : before.data,
        notes: patch.notes ?? before.notes,
        response: patch.response ?? before.response,
      };
      if (preview) {
        savePreview(next);
        return;
      }
      apply(next);
      pending.current = { ...(pending.current ?? {}), ...patch, data: patch.data ? { ...(pending.current?.data ?? {}), ...patch.data } : pending.current?.data };
      setSaveStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
    },
    [apply, limits, preview, savePreview, step.disabled],
  );

  const judge = useCallback(
    (snapshot: StepSnapshot) =>
      evaluateCompletion(
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
      ),
    [step.guideStepIds, step.rule, step.threshold, step.type],
  );

  const complete = useCallback<PlayerStore["complete"]>(async () => {
    if (step.disabled || currentRef.current.status === "completed") return { ok: true };
    if (preview) {
      const check = judge(currentRef.current);
      const unplayable = !check.complete && check.code === "watch_more" && !step.videoPlayable;
      // Nothing real can be submitted from a preview, so an evidence step is simply walked through.
      if (check.complete || unplayable || isEvidenceRule(step.rule)) {
        savePreview({ ...currentRef.current, status: "completed" });
        return { ok: true };
      }
      return { ok: false, message: check.message };
    }
    await flushLive();
    if (stoppedRef.current) return { ok: false, message: "Your work is saved." };
    const outcome = await send({ intent: "complete" });
    if (!outcome.ok) {
      const stopCode = STOP_CODES[outcome.code];
      if (stopCode) stop({ reason: stopCode, message: outcome.message });
      return { ok: false, message: outcome.message };
    }
    settle(outcome.result);
    if (outcome.result.stopped) return { ok: false, message: outcome.result.stopped.message };
    if (outcome.result.status === "completed") return { ok: true };
    return { ok: false, message: outcome.result.completion?.message ?? "This step isn't finished yet." };
  }, [flushLive, judge, preview, savePreview, send, settle, step.disabled, step.rule, step.videoPlayable, stop]);

  const skip = useCallback<PlayerStore["skip"]>(async () => {
    if (step.disabled || currentRef.current.status === "completed") return { ok: true };
    if (!canSkipStep(step.type)) return { ok: false, message: "The last step can't be skipped. Send in your work when you're ready." };
    if (preview) {
      savePreview({ ...currentRef.current, status: "skipped" });
      return { ok: true };
    }
    await flushLive();
    const outcome = await send({ intent: "skip" });
    if (!outcome.ok) return { ok: false, message: outcome.message };
    settle(outcome.result);
    return outcome.result.stopped ? { ok: false, message: outcome.result.stopped.message } : { ok: true };
  }, [flushLive, preview, savePreview, send, settle, step.disabled, step.type]);

  const submitQuiz = useCallback<PlayerStore["submitQuiz"]>(
    async (answers) => {
      const record = (result: QuizResult & { attemptNumber: number }) => {
        const before = currentRef.current;
        const quiz = { attempts: (before.quiz?.attempts ?? 0) + 1, passed: (before.quiz?.passed ?? false) || result.passed, bestScore: Math.max(before.quiz?.bestScore ?? 0, result.score) };
        const next: StepSnapshot = { ...before, quiz, status: result.passed ? "completed" : before.status === "completed" ? "completed" : "in_progress" };
        if (preview) savePreview(next);
        else apply(next);
      };
      if (preview) {
        if (!gradePreview) return { error: "Quiz marking isn't available in this preview." };
        const outcome = await gradePreview(versionId, step.key, answers);
        if (!("error" in outcome)) record(outcome);
        return outcome;
      }
      let response: Response;
      try {
        response = await fetch(`${endpoint}/quiz-attempts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }), credentials: "same-origin" });
      } catch {
        return { error: "We couldn't reach the server. Check your connection, then try again. Your answers are still here." };
      }
      if (!response.ok) {
        const error = await readError(response);
        const stopCode = STOP_CODES[error.code];
        if (stopCode) stop({ reason: stopCode, message: error.message });
        return { error: error.message };
      }
      const result = (await response.json()) as QuizResult & { attemptNumber: number };
      record(result);
      return result;
    },
    [apply, endpoint, gradePreview, preview, savePreview, step.key, stop, versionId],
  );

  const flush = useCallback(async () => {
    if (!preview) await flushLive();
  }, [flushLive, preview]);

  const value = useMemo<PlayerStore>(
    () => ({ mode, step, current, statuses, saveStatus, stopped, update, complete, skip, submitQuiz, flush, stop, coachOpen, setCoachOpen }),
    [coachOpen, complete, current, flush, mode, saveStatus, skip, statuses, step, stop, stopped, submitQuiz, update],
  );

  return <PlayerContext value={value}>{children}</PlayerContext>;
}

