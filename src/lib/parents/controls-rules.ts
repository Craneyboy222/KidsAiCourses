/**
 * Validation for a parent's controls (spec 3.6): the daily time cap, quiet hours, blocks and the
 * pause reason. Pure, so the form, the action and the tests all share one set of rules.
 */
import { z } from "zod";
import { CATEGORY_SLUGS } from "@/content/schema";

/** The shortest and longest daily limit a parent can set, in minutes. */
export const MIN_DAILY_CAP_MIN = 5;
export const MAX_DAILY_CAP_MIN = 720;
/** The limits offered in the form. Any whole number between the two bounds is accepted. */
export const DAILY_CAP_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240] as const;

export const MAX_BLOCKED_COURSES = 200;
export const MAX_PAUSE_REASON = 200;

const MINUTES_IN_DAY = 1440;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `"21:00"` → 1260. `null` for anything that is not a 24-hour time (`24:00`, `9:5`, `21.00`). */
export function clockToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** `1260` → `"21:00"`, for filling in a time field. */
export function minutesToClockValue(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** How long a quiet window lasts, in minutes. It may run past midnight. Equal ends mean none (0). */
export function quietWindowLength(startMin: number, endMin: number): number {
  return (((endMin - startMin) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
}

export type DailyCapResult = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * The daily limit as typed or chosen. An empty value, `none` or `off` means no limit. Otherwise a
 * whole number of minutes between the bounds: `0`, fractions and anything over 12 hours are refused
 * rather than quietly rounded, because a mistake here either locks a child out or switches the limit off.
 */
export function parseDailyCap(input: string | number | null | undefined): DailyCapResult {
  if (input === null || input === undefined) return { ok: true, value: null };
  const text = typeof input === "number" ? String(input) : input.trim().toLowerCase();
  if (text === "" || text === "none" || text === "off") return { ok: true, value: null };
  if (!/^\d{1,4}$/.test(text)) return { ok: false, message: "Enter the daily limit as a whole number of minutes, for example 60." };
  const minutes = Number(text);
  if (minutes < MIN_DAILY_CAP_MIN) return { ok: false, message: `The shortest daily limit is ${MIN_DAILY_CAP_MIN} minutes. To stop learning altogether for now, pause the account instead.` };
  if (minutes > MAX_DAILY_CAP_MIN) return { ok: false, message: `The longest daily limit is ${MAX_DAILY_CAP_MIN / 60} hours (${MAX_DAILY_CAP_MIN} minutes). Choose "No daily limit" if you don't want one.` };
  return { ok: true, value: minutes };
}

export type QuietHoursResult = { ok: true; startMin: number; endMin: number } | { ok: false; field: "quietStart" | "quietEnd"; message: string };

/**
 * Quiet hours as the form sends them. Off is stored as two equal values (midnight to midnight),
 * which is what "no quiet hours" means everywhere else. On needs two real times that differ.
 */
export function parseQuietHours(input: { enabled: boolean; start: string; end: string }): QuietHoursResult {
  if (!input.enabled) return { ok: true, startMin: 0, endMin: 0 };
  const startMin = clockToMinutes(input.start);
  if (startMin === null) return { ok: false, field: "quietStart", message: "Enter the time quiet hours start, for example 21:00." };
  const endMin = clockToMinutes(input.end);
  if (endMin === null) return { ok: false, field: "quietEnd", message: "Enter the time quiet hours end, for example 07:00." };
  if (startMin === endMin) return { ok: false, field: "quietEnd", message: "Quiet hours can't start and end at the same time. Change one of them, or switch quiet hours off." };
  return { ok: true, startMin, endMin };
}

export type ControlsInput = {
  dailyMinutesCap: number | null;
  quietStartMin: number;
  quietEndMin: number;
  blockedCategories: string[];
  blockedCourseIds: string[];
  requireApprovalForPro: boolean;
};

const dedupe = (values: string[]): string[] => [...new Set(values)];

/** What the service accepts. The action builds it from the form with `parseControlsForm`. */
export const controlsInputSchema = z
  .object({
    dailyMinutesCap: z.number().int().min(MIN_DAILY_CAP_MIN).max(MAX_DAILY_CAP_MIN).nullable(),
    quietStartMin: z.number().int().min(0).max(MINUTES_IN_DAY - 1),
    quietEndMin: z.number().int().min(0).max(MINUTES_IN_DAY - 1),
    blockedCategories: z.array(z.enum(CATEGORY_SLUGS)).max(CATEGORY_SLUGS.length).transform(dedupe),
    blockedCourseIds: z.array(z.string().regex(UUID)).max(MAX_BLOCKED_COURSES).transform((ids) => dedupe(ids.map((id) => id.toLowerCase()))),
    requireApprovalForPro: z.boolean(),
  })
  .strict();

export type ControlsFormValues = {
  dailyCap: string;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  blockedCategories: string[];
  blockedCourseIds: string[];
  requireApprovalForPro: boolean;
};

export type ControlsFormResult = { ok: true; value: ControlsInput } | { ok: false; fieldErrors: Record<string, string[]> };

/** Turns the posted form into controls, or says which fields to fix. Every problem is reported at once. */
export function parseControlsForm(form: ControlsFormValues): ControlsFormResult {
  const fieldErrors: Record<string, string[]> = {};
  const cap = parseDailyCap(form.dailyCap);
  if (!cap.ok) fieldErrors.dailyCap = [cap.message];
  const quiet = parseQuietHours({ enabled: form.quietEnabled, start: form.quietStart, end: form.quietEnd });
  if (!quiet.ok) fieldErrors[quiet.field] = [quiet.message];

  const categories = dedupe(form.blockedCategories);
  if (categories.some((slug) => !(CATEGORY_SLUGS as readonly string[]).includes(slug))) fieldErrors.blockedCategories = ["One of those subjects isn't one we know. Refresh the page and try again."];
  const courseIds = dedupe(form.blockedCourseIds.map((id) => id.toLowerCase()));
  if (courseIds.some((id) => !UUID.test(id))) fieldErrors.blockedCourseIds = ["One of those courses couldn't be found. Refresh the page and try again."];
  else if (courseIds.length > MAX_BLOCKED_COURSES) fieldErrors.blockedCourseIds = [`You can block up to ${MAX_BLOCKED_COURSES} courses one by one. To block more, block the whole subject.`];

  if (!cap.ok || !quiet.ok || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    value: {
      dailyMinutesCap: cap.value,
      quietStartMin: quiet.startMin,
      quietEndMin: quiet.endMin,
      blockedCategories: categories,
      blockedCourseIds: courseIds,
      requireApprovalForPro: form.requireApprovalForPro,
    },
  };
}

/** A parent's reason for pausing, shown to the child. Optional; trimmed, one line, at most 200 characters. */
export function cleanPauseReason(input: string | null | undefined): { ok: true; value: string | null } | { ok: false; message: string } {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return { ok: true, value: null };
  if (text.length > MAX_PAUSE_REASON) return { ok: false, message: `Keep the reason to ${MAX_PAUSE_REASON} characters or fewer.` };
  return { ok: true, value: text };
}
