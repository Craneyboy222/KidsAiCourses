"use client";

import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { isPreview, type PlayerMode } from "@/components/course/types";
import type { StepState } from "@/lib/learning/completion";
import type { QuizAnswers } from "@/lib/learning/quiz-grading";
import { LiveSession, PreviewSession, type PlayerSession, type QuizOutcome, type SaveStatus, type SessionState, type StepMeta, type StepPatch, type StepSnapshot, type StopReason } from "./session";

export type { QuizOutcome, SaveStatus, StepMeta, StepSnapshot, StopReason };

/** What the small client islands on a step (video, ticks, notes, quiz, hints, Next) read and call. */
export type PlayerStore = SessionState & {
  mode: PlayerMode;
  step: StepMeta;
  update(patch: StepPatch): void;
  /** Asks for the step to be completed. Resolves with why not, in words for the learner. */
  complete: PlayerSession["complete"];
  skip: PlayerSession["skip"];
  submitQuiz: PlayerSession["submitQuiz"];
  /** Sends anything waiting to be saved, now. */
  flush: PlayerSession["flush"];
  stop: PlayerSession["stop"];
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
  /** Preview only: marks a quiz on the server without writing anything. */
  gradePreview?: (versionId: string, stepKey: string, answers: QuizAnswers) => Promise<QuizOutcome>;
  children: ReactNode;
};

const NOTHING: { statuses: Record<string, StepState>; current: StepSnapshot } = { statuses: {}, current: { status: "not_started", data: {}, notes: "", response: "", quiz: null } };

/**
 * Holds one step's session (see `session.ts`) and shares it with everything on the step. Mount it
 * with a `key` per step, so each step gets a fresh session.
 */
export function PlayerProvider({ mode, step, order, initial, gradePreview, children }: PlayerProviderProps) {
  const [session] = useState<PlayerSession>(() =>
    isPreview(mode)
      ? new PreviewSession({ versionId: mode.versionId, step, order: order.map((entry) => entry.key), grade: gradePreview })
      : new LiveSession({ enrolmentId: mode.enrolmentId, step, initial: initial ?? NOTHING }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getServerState);
  const [coachOpen, setCoachOpen] = useState(false);

  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);

  const value = useMemo<PlayerStore>(
    () => ({ ...state, mode, step, update: session.update, complete: session.complete, skip: session.skip, submitQuiz: session.submitQuiz, flush: session.flush, stop: session.stop, coachOpen, setCoachOpen }),
    [coachOpen, mode, session, state, step],
  );
  return <PlayerContext value={value}>{children}</PlayerContext>;
}
