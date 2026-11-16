/**
 * Completion rules for course steps (spec 3.2: "Completion rules are enforced on the server").
 *
 * Pure and safe for the browser. The server is the judge for a real learner (`progress.ts` calls
 * `evaluateCompletion` before it marks anything done); a staff preview uses the same function on
 * its in-browser progress, so a draft behaves exactly as the live course will.
 */
import type { CompletionRule, StepType } from "@/content/schema";

/** How much of a video counts as watched when the course does not say. */
export const DEFAULT_VIDEO_THRESHOLD = 0.8;

/** What we know about a learner's work on one step. */
export type StepEvidence = {
  /** Largest share of the video played so far, 0 to 1. */
  watchedFraction?: number;
  /** The learner opened the transcript: reading it counts the same as watching. */
  transcriptRead?: boolean;
  /** "I've done this", or the acknowledgement at the end of a setup guide. */
  ticked?: boolean;
  /** Setup-guide step ids ticked off. */
  guideTicks?: readonly string[];
  /** Characters written for a reflection or an ethics checkpoint (trimmed). */
  responseLength?: number;
  quizPassed?: boolean;
  /** Set by the submissions service through `recordEvidenceOutcome`, never by the learner's browser. */
  evidence?: "none" | "submitted" | "accepted" | "rejected";
};

export type CompletionStep = {
  type: StepType;
  rule: CompletionRule;
  /** A fraction from 0 to 1: the share of a video to watch, or the quiz pass mark. */
  threshold?: number | null;
  /** For `setup_acknowledged`: the guide steps this course step covers. */
  guideStepIds?: readonly string[];
};

export type CompletionCode =
  | "watch_more"
  | "tick_needed"
  | "response_needed"
  | "guide_steps_left"
  | "quiz_not_passed"
  | "evidence_needed"
  | "evidence_not_accepted";

export type CompletionCheck = { complete: true } | { complete: false; code: CompletionCode; message: string };

const no = (code: CompletionCode, message: string): CompletionCheck => ({ complete: false, code, message });
const YES: CompletionCheck = { complete: true };

/** Steps where the learner writes something of their own. */
export const isWrittenStep = (type: StepType): boolean => type === "reflection" || type === "ethics_checkpoint";

/** Rules that only the submissions service can satisfy. The browser can never complete these directly. */
export const isEvidenceRule = (rule: CompletionRule): boolean =>
  rule === "upload_approved" || rule === "evidence_submitted" || rule === "submit";

/** Is this step done, given what the learner has done so far? */
export function evaluateCompletion(step: CompletionStep, evidence: StepEvidence): CompletionCheck {
  switch (step.rule) {
    case "view": {
      if (step.type !== "video") return YES;
      const needed = step.threshold ?? DEFAULT_VIDEO_THRESHOLD;
      if (evidence.transcriptRead === true) return YES;
      if ((evidence.watchedFraction ?? 0) + 1e-9 >= needed) return YES;
      return no("watch_more", "Watch a bit more of the video, or read the transcript, and this step will tick itself off.");
    }
    case "self_tick": {
      if (isWrittenStep(step.type) && (evidence.responseLength ?? 0) < 1) {
        return no("response_needed", "Write a sentence or two first. It's only for you.");
      }
      if (evidence.ticked !== true) return no("tick_needed", "Tick the box to say you've done this.");
      return YES;
    }
    case "setup_acknowledged": {
      const ticked = new Set(evidence.guideTicks ?? []);
      const left = (step.guideStepIds ?? []).filter((id) => !ticked.has(id)).length;
      if (left > 0) return no("guide_steps_left", `Tick off the ${left === 1 ? "last setup step" : `${left} setup steps still to do`} first.`);
      if (evidence.ticked !== true) return no("tick_needed", "Tick the box to say your account is set up.");
      return YES;
    }
    case "quiz_pass":
      return evidence.quizPassed === true ? YES : no("quiz_not_passed", "Pass the quiz to finish this step. You can try as many times as you like.");
    case "upload_approved":
      return evidence.evidence === "accepted" ? YES : no("evidence_not_accepted", "This step is done once your upload has been checked and accepted.");
    case "evidence_submitted":
    case "submit":
      return evidence.evidence === "submitted" || evidence.evidence === "accepted" ? YES : no("evidence_needed", "Send in your work to finish this step.");
  }
}

/** Skip-ahead is allowed on every step except the final submit (spec 3.2). */
export const canSkipStep = (type: StepType): boolean => type !== "submit";

export type StepState = "not_started" | "in_progress" | "completed" | "skipped";

export type ProgressStep = { key: string; status: StepState; disabled: boolean };

export type CourseProgress = {
  /** Steps that count: disabled steps are left out of both numbers. */
  total: number;
  completed: number;
  percent: number;
  /** Every step that counts is completed. */
  done: boolean;
};

/** A step switched off by staff is not required, so it never holds a course open. */
export function courseProgress(steps: readonly ProgressStep[]): CourseProgress {
  const counted = steps.filter((step) => !step.disabled);
  const completed = counted.filter((step) => step.status === "completed").length;
  const total = counted.length;
  return { total, completed, percent: total === 0 ? 0 : Math.round((completed / total) * 100), done: total > 0 && completed === total };
}

/**
 * Where "Continue" goes: the stored resume point if it is still usable, otherwise the first step
 * that is not finished, otherwise the last step.
 */
export function resumeStepKey(steps: readonly ProgressStep[], currentKey?: string | null): string | null {
  if (steps.length === 0) return null;
  const current = currentKey ? steps.find((step) => step.key === currentKey) : undefined;
  if (current && !current.disabled && current.status !== "completed") return current.key;
  const next = steps.find((step) => !step.disabled && step.status !== "completed");
  return (next ?? steps[steps.length - 1])?.key ?? null;
}
