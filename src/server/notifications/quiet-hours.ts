import { TZDate } from "@date-fns/tz";
import { DISPLAY_TZ, inMinuteWindow, londonMinutesOfDay } from "@/lib/dates";

/**
 * Quiet hours (spec 3.5, 3.10): a parent chooses a window, in UK time, when their child gets no
 * notifications. Anything raised inside the window waits until the window ends. Pure functions.
 */
export type QuietWindow = { startMin: number; endMin: number };

/** `"21:00"` → 1260. Returns `null` for anything that is not a 24-hour time. */
export function hhmmToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const validMinute = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1440;

/**
 * The window that applies to a learner: the parent's own choice when both ends are set,
 * otherwise the site default. A start equal to the end means "no quiet hours".
 */
export function effectiveQuietWindow(
  parentChoice: { quietStartMin: number | null; quietEndMin: number | null } | null | undefined,
  siteDefault: { start: string; end: string },
): QuietWindow | null {
  if (parentChoice && validMinute(parentChoice.quietStartMin) && validMinute(parentChoice.quietEndMin)) {
    return parentChoice.quietStartMin === parentChoice.quietEndMin
      ? null
      : { startMin: parentChoice.quietStartMin, endMin: parentChoice.quietEndMin };
  }
  const startMin = hhmmToMinutes(siteDefault.start);
  const endMin = hhmmToMinutes(siteDefault.end);
  return startMin === null || endMin === null || startMin === endMin ? null : { startMin, endMin };
}

/** Is `now` inside the window, in UK time? The window may run past midnight (21:00–07:00). */
export function isQuietNow(now: Date, window: QuietWindow | null): boolean {
  return window !== null && inMinuteWindow(londonMinutesOfDay(now), window.startMin, window.endMin);
}

/**
 * When a notification raised at `now` may be shown: `null` for straight away, otherwise the
 * moment the current quiet window ends, in UK time. Clock changes are handled by building the
 * end time in the Europe/London zone rather than by adding minutes.
 */
export function quietHoursDeliverAfter(now: Date, window: QuietWindow | null): Date | null {
  if (!window || !isQuietNow(now, window)) return null;
  const minutesNow = londonMinutesOfDay(now);
  const london = new TZDate(now.getTime(), DISPLAY_TZ);
  // The window ends later today if its end is still ahead of us on the clock, otherwise tomorrow.
  const dayOffset = window.endMin > minutesNow ? 0 : 1;
  const end = new TZDate(
    london.getFullYear(),
    london.getMonth(),
    london.getDate() + dayOffset,
    Math.floor(window.endMin / 60),
    window.endMin % 60,
    0,
    0,
    DISPLAY_TZ,
  );
  return new Date(end.getTime());
}
