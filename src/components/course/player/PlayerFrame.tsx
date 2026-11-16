"use client";

import { ArrowRight, Check, MessageCircleQuestion } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CoachPanel } from "@/components/coach/CoachPanel";
import { isPreview } from "@/components/course/types";
import { PlayerPrevious, PlayerShell } from "@/components/layout";
import { Button, Callout, LinkButton, LiveRegion, type StepperStep } from "@/components/ui";
import { canSkipStep, type StepState } from "@/lib/learning/completion";
import { usePlayer, type SaveStatus, type StopReason } from "./store";

export type PlayerFrameProps = {
  courseSlug: string;
  courseTitle: string;
  lessonTitle: string;
  /** The course page. */
  exitHref: string;
  stepTitle: string;
  hints: string[];
  /** The steps of this lesson, in order. */
  lessonSteps: { key: string; title: string; href: string; disabled: boolean }[];
  prevHref: string | null;
  /** The next step, or null on the last step of the course. */
  nextHref: string | null;
  /** The Report control for this step, rendered on the server. */
  report?: ReactNode;
  children: ReactNode;
};

const SAVE_WORDS: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  retrying: "Couldn't save yet. Trying again…",
  failed: "Not saved. Check your connection, then carry on: we'll try again.",
};

const STOP_TITLES: Record<StopReason["reason"], string> = {
  time_cap: "That's your time for today",
  quiet_hours: "It's quiet hours",
  paused: "Your account is paused",
  consent: "A parent needs to finish your permissions",
  not_active: "Your account isn't switched on",
};

function stepperStatus(status: StepState | undefined, current: boolean, disabled: boolean): StepperStep["status"] {
  if (current) return "current";
  if (disabled) return "locked";
  return status === "completed" ? "done" : "upcoming";
}

/** How often active time is reported, and the most one report may claim (the server bounds it again). */
const HEARTBEAT_MS = 30_000;

type HeartbeatAnswer = { allowed: true; minutesLeftToday: number | null } | { allowed: false; reason: StopReason["reason"]; message: string };

/**
 * Counts time only while this tab is visible, and tells the server every 30 seconds. When the
 * server says the daily cap or quiet hours have arrived, work in hand is saved first, then the
 * step is replaced by the stop screen.
 */
function useHeartbeat(enabled: boolean, onAnswer: (answer: HeartbeatAnswer) => void): void {
  const handler = useRef(onAnswer);
  useEffect(() => {
    handler.current = onAnswer;
  });
  useEffect(() => {
    if (!enabled) return;
    let visibleSince = document.visibilityState === "visible" ? Date.now() : null;
    let banked = 0;
    const bank = () => {
      if (visibleSince !== null) {
        banked += (Date.now() - visibleSince) / 1000;
        visibleSince = Date.now();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") visibleSince = Date.now();
      else {
        bank();
        visibleSince = null;
      }
    };
    const beat = async () => {
      bank();
      const seconds = Math.round(banked);
      if (seconds < 1) return;
      banked = 0;
      try {
        const response = await fetch("/api/v1/usage/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seconds }), credentials: "same-origin" });
        if (response.ok) handler.current((await response.json()) as HeartbeatAnswer);
      } catch {
        // Offline: the time is simply not counted. Learning is never blocked by a failed heartbeat.
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [enabled]);
}

/**
 * The frame around a step: the shell, the step list with live statuses, Coach, the save status,
 * Previous and Next. The step itself arrives as `children`, already rendered on the server.
 */
export function PlayerFrame({ courseSlug, courseTitle, lessonTitle, exitHref, stepTitle, hints, lessonSteps, prevHref, nextHref, report, children }: PlayerFrameProps) {
  const store = usePlayer();
  const router = useRouter();
  const preview = isPreview(store.mode);
  const { step, current, statuses, stopped } = store;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);

  useHeartbeat(!preview && !stopped, (answer) => {
    if (answer.allowed) {
      setMinutesLeft(answer.minutesLeftToday);
      return;
    }
    // Save first, then stop.
    void store.flush().finally(() => store.stop({ reason: answer.reason, message: answer.message }));
  });

  const steps: StepperStep[] = lessonSteps.map((entry) => {
    const status = statuses[entry.key];
    const isCurrent = entry.key === step.key;
    const note = entry.disabled ? " (switched off)" : status === "skipped" && !isCurrent ? " (skipped)" : "";
    return {
      id: entry.key,
      label: (
        <>
          {entry.title}
          {note && <span className="text-ink-muted text-sm">{note}</span>}
        </>
      ),
      status: stepperStatus(status, isCurrent, entry.disabled),
      href: isCurrent ? undefined : entry.href,
    };
  });

  const done = step.disabled || current.status === "completed";
  const go = (href: string | null) => router.push(href ?? exitHref);

  async function onNext() {
    setProblem(null);
    if (done) return go(nextHref);
    setBusy(true);
    const outcome = await store.complete();
    setBusy(false);
    if (outcome.ok) go(nextHref);
    else setProblem(outcome.message);
  }

  async function onSkip() {
    setBusy(true);
    const outcome = await store.skip();
    setBusy(false);
    if (outcome.ok) {
      setProblem(null);
      go(nextHref);
    } else setProblem(outcome.message);
  }

  const saveWords = preview ? "Preview: nothing here is saved." : SAVE_WORDS[store.saveStatus];
  const nextLabel = nextHref ? "Next" : "Finish";

  return (
    <PlayerShell
      courseTitle={courseTitle}
      lessonTitle={lessonTitle}
      exitHref={exitHref}
      steps={steps}
      headerActions={report}
      coach={
        <>
          <Button variant="secondary" onClick={() => store.setCoachOpen(true)} iconStart={<MessageCircleQuestion aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.25} />}>
            I&apos;m stuck
          </Button>
          <CoachPanel mode={store.mode} courseSlug={courseSlug} stepKey={step.key} stepTitle={stepTitle} hints={hints} open={store.coachOpen} onOpenChange={store.setCoachOpen} />
        </>
      }
      notices={
        <>
          {preview && (
            <Callout tone="warning" title="Staff preview">
              <p>This is the real learner view of a draft. Nothing you do here is saved, and no learner can see it.</p>
            </Callout>
          )}
          {!stopped && minutesLeft !== null && minutesLeft <= 5 && (
            <Callout tone="info" title={minutesLeft <= 1 ? "About a minute left today" : `About ${minutesLeft} minutes left today`}>
              <p>Your work saves by itself, so there&apos;s no rush to finish this step.</p>
            </Callout>
          )}
        </>
      }
      previous={prevHref && !stopped ? <PlayerPrevious href={prevHref} /> : undefined}
      next={
        stopped ? (
          <LinkButton href="/home">Back to home</LinkButton>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <LiveRegion visible className="text-ink-muted text-sm">
              {saveWords}
            </LiveRegion>
            <Button
              onClick={() => void onNext()}
              loading={busy}
              loadingText="Checking…"
              iconEnd={nextHref ? <ArrowRight aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} /> : <Check aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />}
            >
              {nextLabel}
            </Button>
          </div>
        )
      }
    >
      {stopped ? (
        <section aria-labelledby="stop-title" className="flex flex-col gap-4">
          <h1 id="stop-title" className="text-3xl font-bold">
            {STOP_TITLES[stopped.reason]}
          </h1>
          <Callout tone="info" live="status">
            <p>{stopped.message}</p>
          </Callout>
          <p className="text-ink-muted">You&apos;ll come back to exactly this step.</p>
        </section>
      ) : (
        <>
          {children}
          {problem && (
            <Callout
              tone="warning"
              live="alert"
              title="Not quite finished"
              className="mt-6"
              actions={
                canSkipStep(step.type) ? (
                  <Button variant="secondary" onClick={() => void onSkip()} loading={busy}>
                    Skip this step for now
                  </Button>
                ) : undefined
              }
            >
              <p>{problem}</p>
              {canSkipStep(step.type) && <p className="text-ink-muted text-sm">A skipped step stays marked so you can come back to it. The course is finished when every step is done.</p>}
            </Callout>
          )}
        </>
      )}
    </PlayerShell>
  );
}
