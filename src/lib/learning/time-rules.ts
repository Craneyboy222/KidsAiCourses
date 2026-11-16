/**
 * Daily cap and quiet-hours maths (spec 3.2, 3.6). Pure: the service passes in the clock, the
 * parent's controls and today's total.
 */
import { inMinuteWindow, londonMinutesOfDay } from "@/lib/dates";

export type TimeControls = {
  /** null means no cap. */
  dailyMinutesCap: number | null;
  /** Minutes since midnight, UK time. Equal values mean no quiet hours. */
  quietStartMin: number;
  quietEndMin: number;
};

/** Minutes of today's allowance left, rounded down. `null` when there is no cap. Never negative. */
export function minutesLeftToday(capMinutes: number | null, usedSeconds: number): number | null {
  if (capMinutes === null) return null;
  const left = Math.max(0, capMinutes) * 60 - Math.max(0, usedSeconds);
  return left <= 0 ? 0 : Math.floor(left / 60);
}

/** The cap is a hard stop: reached as soon as today's seconds meet it. A cap of 0 means no learning today. */
export function capReached(capMinutes: number | null, usedSeconds: number): boolean {
  return capMinutes !== null && Math.max(0, usedSeconds) >= Math.max(0, capMinutes) * 60;
}

/** Is `now` inside the parent's quiet hours, in UK time? The window may run past midnight. */
export function inQuietHours(now: Date, controls: Pick<TimeControls, "quietStartMin" | "quietEndMin">): boolean {
  return inMinuteWindow(londonMinutesOfDay(now), controls.quietStartMin, controls.quietEndMin);
}

/** `1260` → `21:00`. */
export function minutesToClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The longest gap between two heartbeats that still counts as one stretch of activity. */
export const HEARTBEAT_MAX_SECONDS = 90;

/**
 * How many seconds a heartbeat may add.
 *
 * The browser says how long the tab was visible since its last beat. That number is never trusted
 * beyond what the clock allows: at most `HEARTBEAT_MAX_SECONDS`, and never more than the time that
 * has really passed since the last beat we stored (so two tabs, or a replayed request, cannot
 * count the same minute twice). It is also cut off at the cap, so the total never passes it.
 */
export function creditableSeconds(input: { claimed: number; secondsSinceLast: number | null; capMinutes: number | null; usedSeconds: number }): number {
  if (!Number.isFinite(input.claimed) || input.claimed <= 0) return 0;
  let seconds = Math.min(Math.floor(input.claimed), HEARTBEAT_MAX_SECONDS);
  if (input.secondsSinceLast !== null) seconds = Math.min(seconds, Math.max(0, Math.floor(input.secondsSinceLast)));
  if (input.capMinutes !== null) seconds = Math.min(seconds, Math.max(0, Math.max(0, input.capMinutes) * 60 - Math.max(0, input.usedSeconds)));
  return Math.max(0, seconds);
}
