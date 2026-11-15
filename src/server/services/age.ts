import { londonYearMonth } from "@/lib/dates";
import type { Pathway, SafetyBand } from "@/server/authz/actor";

/**
 * Age, safety band and pathway from a birth month and year (spec Section 2 and 3.1).
 *
 * We hold only the month and year a learner was born, never the day, so for the whole of their
 * birth month we cannot know whether the birthday has happened yet. The rule, everywhere:
 *
 *   WHEN IN DOUBT, THE LEARNER IS THE YOUNGER AGE.
 *
 * A birthday counts only once the birth month is completely over in Europe/London, that is from
 * the first day of the following month, London time. So someone born in November 2013 is treated
 * as 12 for all of November 2026 and as 13 from 1 December 2026. A learner can be treated as up to
 * a month younger than they are, and never as older. That is the safe direction for every rule
 * that hangs off age: the under-13 block, the stricter 13–15 band, a course's `minAge` and what an
 * 18-year-old may do alone.
 *
 * Pure functions: the clock is always passed in.
 */

export const MINIMUM_AGE = 13;
export const ADULT_AGE = 18;

function assertBirth(birthYear: number, birthMonth: number): void {
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2200) {
    throw new RangeError("birthYear must be a four-digit year");
  }
  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) {
    throw new RangeError("birthMonth must be a whole number from 1 (January) to 12 (December)");
  }
}

/**
 * Age in whole years, taking the younger reading. Negative when the birth month is in the future.
 * `birthMonth` is 1–12.
 */
export function ageFromBirth(birthYear: number, birthMonth: number, now: Date): number {
  assertBirth(birthYear, birthMonth);
  const { year, month } = londonYearMonth(now);
  // The birthday has certainly passed only when the current London month is later than the birth month.
  const birthdayCertainlyPassed = month > birthMonth;
  return year - birthYear - (birthdayCertainlyPassed ? 0 : 1);
}

/** Null under 13: there is no band, because under-13s cannot hold an account. */
export function safetyBandForAge(age: number): SafetyBand | null {
  if (age < MINIMUM_AGE) return null;
  if (age <= 15) return "teen_13_15";
  if (age <= 17) return "teen_16_17";
  return "adult_18";
}

/**
 * The default pathway for discovery: 13–14 `ks3`, 15–16 `ks4`, 17 and over `sixth_form`.
 * Null under 13. A course's `minAge` is enforced whatever pathway a learner browses.
 */
export function pathwayForAge(age: number): Pathway | null {
  if (age < MINIMUM_AGE) return null;
  if (age <= 14) return "ks3";
  if (age <= 16) return "ks4";
  return "sixth_form";
}

/** True when the person must be stopped at sign-up. Nothing about them may be stored. */
export function isUnder13(birthYear: number, birthMonth: number, now: Date): boolean {
  return ageFromBirth(birthYear, birthMonth, now) < MINIMUM_AGE;
}

const BAND_ORDER: readonly SafetyBand[] = ["teen_13_15", "teen_16_17", "adult_18"];

/** The stricter (younger) of two bands. Used when a stored band and a freshly calculated one disagree. */
export function stricterBand(a: SafetyBand, b: SafetyBand): SafetyBand {
  return BAND_ORDER.indexOf(a) <= BAND_ORDER.indexOf(b) ? a : b;
}
