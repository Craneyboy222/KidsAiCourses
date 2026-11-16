import { TZDate } from "@date-fns/tz";
import { DISPLAY_TZ } from "@/lib/dates";

/**
 * Response-target maths for the moderation queue (spec Section 9). Pure: no database, no clock.
 *
 * A target of "8 hours" means eight hours INSIDE the working window (UK time, 08:00–22:00 by
 * default). Time outside the window does not count, so an item raised at 21:00 with an 8-hour
 * target is due at 15:00 the next day, not at 05:00.
 */
export type SlaWindow = { start: string; end: string };
export type SlaHours = { critical: number; high: number; normal: number };
export type SlaSeverity = keyof SlaHours;

export const DEFAULT_SLA_HOURS: SlaHours = { critical: 4, high: 8, normal: 48 };
export const DEFAULT_SLA_WINDOW: SlaWindow = { start: "08:00", end: "22:00" };

const MINUTE = 60_000;

/** `"08:30"` → 510. Null when it is not a time. */
export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return value.trim() === "24:00" ? 1440 : null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The instant of `minutes` past midnight, UK time, on the UK calendar day `daysAhead` days after `from`. */
function londonInstant(from: Date, daysAhead: number, minutes: number): number {
  const local = new TZDate(from.getTime(), DISPLAY_TZ);
  return new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + daysAhead, Math.floor(minutes / 60), minutes % 60, 0, DISPLAY_TZ).getTime();
}

/**
 * When an item raised at `from` is due. A window that is empty, back to front or unreadable is
 * treated as the whole day, which only ever makes the deadline EARLIER: a mis-set window can never
 * quietly give staff longer than the target.
 */
export function slaDueAt(from: Date, hours: number, window: SlaWindow = DEFAULT_SLA_WINDOW): Date {
  const target = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SLA_HOURS.normal;
  let remaining = Math.round(target * 60) * MINUTE;
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  if (start === null || end === null || end <= start) return new Date(from.getTime() + remaining);

  let cursor = from.getTime();
  // A target of n hours can never need more than n days of windows plus a few: the bound stops a bad input looping.
  for (let day = 0; day < Math.ceil(target) + 7; day += 1) {
    const opens = londonInstant(from, day, start);
    const closes = londonInstant(from, day, end);
    if (cursor < opens) cursor = opens;
    if (cursor < closes) {
      const available = closes - cursor;
      if (remaining <= available) return new Date(cursor + remaining);
      remaining -= available;
      cursor = closes;
    }
  }
  return new Date(cursor + remaining);
}

export function slaDueFor(from: Date, severity: SlaSeverity, hours: SlaHours = DEFAULT_SLA_HOURS, window: SlaWindow = DEFAULT_SLA_WINDOW): Date {
  return slaDueAt(from, hours[severity], window);
}
