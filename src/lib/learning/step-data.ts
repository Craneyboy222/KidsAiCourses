/**
 * The small bag of state kept per step (`step_progress.data`): how much of a video has been
 * watched, which setup steps are ticked, how many hints are showing. Pure and safe for the
 * browser: the server uses it to check what a browser sent; a staff preview uses it on its own
 * in-tab progress.
 */
export const VIDEO_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export type StepData = {
  watchedFraction?: number;
  /** Seconds into the video, so playback resumes where it stopped. */
  position?: number;
  speed?: number;
  transcriptRead?: boolean;
  guideTicks?: string[];
  ticked?: boolean;
  /** How many hints have been revealed. */
  hintLevel?: number;
  /** Written by `recordEvidenceOutcome` only: never accepted from a browser. */
  evidence?: "none" | "submitted" | "accepted" | "rejected";
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Reads stored or submitted JSON defensively: it is never trusted to have the right shape. */
export function readStepData(raw: unknown): StepData {
  const data: StepData = {};
  if (typeof raw !== "object" || raw === null) return data;
  const source = raw as Record<string, unknown>;
  if (typeof source.watchedFraction === "number" && Number.isFinite(source.watchedFraction)) data.watchedFraction = clamp(source.watchedFraction, 0, 1);
  if (typeof source.position === "number" && Number.isFinite(source.position)) data.position = clamp(source.position, 0, 24 * 3600);
  if (typeof source.speed === "number" && (VIDEO_SPEEDS as readonly number[]).includes(source.speed)) data.speed = source.speed;
  if (source.transcriptRead === true) data.transcriptRead = true;
  if (Array.isArray(source.guideTicks)) data.guideTicks = [...new Set(source.guideTicks.filter((value): value is string => typeof value === "string"))].slice(0, 100);
  if (typeof source.ticked === "boolean") data.ticked = source.ticked;
  if (typeof source.hintLevel === "number" && Number.isInteger(source.hintLevel)) data.hintLevel = clamp(source.hintLevel, 0, 50);
  if (source.evidence === "none" || source.evidence === "submitted" || source.evidence === "accepted" || source.evidence === "rejected") data.evidence = source.evidence;
  return data;
}

/**
 * Merges what the browser sent into what is stored. Progress only ever moves forward: the watched
 * share and the hint level never go down, a read transcript stays read, guide ticks are limited to
 * the steps this course step covers, and `evidence` cannot be set from here at all.
 */
export function mergeStepData(existing: StepData, incoming: unknown, limits: { hintCount: number; guideStepIds: readonly string[] }): StepData {
  const next = readStepData(incoming);
  const merged: StepData = { ...existing };
  if (next.watchedFraction !== undefined) merged.watchedFraction = Math.max(existing.watchedFraction ?? 0, next.watchedFraction);
  if (next.position !== undefined) merged.position = next.position;
  if (next.speed !== undefined) merged.speed = next.speed;
  if (next.transcriptRead) merged.transcriptRead = true;
  if (next.ticked !== undefined) merged.ticked = next.ticked;
  if (next.hintLevel !== undefined) merged.hintLevel = Math.min(Math.max(existing.hintLevel ?? 0, next.hintLevel), Math.max(0, limits.hintCount));
  if (next.guideTicks !== undefined) {
    const allowed = new Set(limits.guideStepIds);
    merged.guideTicks = next.guideTicks.filter((id) => allowed.has(id));
  }
  return merged;
}
