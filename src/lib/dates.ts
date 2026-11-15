import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** All user-facing dates and times are shown in UK time, whatever the server or browser zone. */
export const DISPLAY_TZ = "Europe/London";

const inLondon = (d: Date | string | number) => new TZDate(new Date(d).getTime(), DISPLAY_TZ);

/** `15 November 2026` */
export function formatDate(d: Date | string | number): string {
  return format(inLondon(d), "d MMMM yyyy");
}
/** `15 Nov 2026` */
export function formatDateShort(d: Date | string | number): string {
  return format(inLondon(d), "d MMM yyyy");
}
/** `21:54` */
export function formatTime(d: Date | string | number): string {
  return format(inLondon(d), "HH:mm");
}
/** `15 November 2026, 21:54` */
export function formatDateTime(d: Date | string | number): string {
  return format(inLondon(d), "d MMMM yyyy, HH:mm");
}
/** Calendar date in London as `yyyy-MM-dd`. Used for daily usage counters and caps. */
export function londonDateKey(d: Date): string {
  return format(inLondon(d), "yyyy-MM-dd");
}
/** Minutes since midnight in London. Used for quiet hours. */
export function londonMinutesOfDay(d: Date): number {
  const l = inLondon(d);
  return l.getHours() * 60 + l.getMinutes();
}
/** London year and month (1–12). Age is calculated from birth month and year only. */
export function londonYearMonth(d: Date): { year: number; month: number } {
  const l = inLondon(d);
  return { year: l.getFullYear(), month: l.getMonth() + 1 };
}
/** True when `minutes` falls inside a window that may wrap past midnight, e.g. 21:00–07:00. */
export function inMinuteWindow(minutes: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  return startMin < endMin ? minutes >= startMin && minutes < endMin : minutes >= startMin || minutes < endMin;
}
/** `45 min`, `1 hr 20 min` */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}
