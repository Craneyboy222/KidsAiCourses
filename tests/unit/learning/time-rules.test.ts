import { describe, expect, it } from "vitest";
import { HEARTBEAT_MAX_SECONDS, capReached, creditableSeconds, inQuietHours, minutesLeftToday, minutesToClock } from "@/lib/learning/time-rules";
import { londonWeekStartKey } from "@/server/services/progress-summary";

describe("daily cap", () => {
  it("has no limit when there is no cap", () => {
    expect(minutesLeftToday(null, 99_999)).toBeNull();
    expect(capReached(null, 99_999)).toBe(false);
  });

  it("counts down in whole minutes and stops exactly at the cap", () => {
    expect(minutesLeftToday(30, 0)).toBe(30);
    expect(minutesLeftToday(30, 61)).toBe(28);
    expect(minutesLeftToday(30, 29 * 60 + 59)).toBe(0);
    expect(capReached(30, 29 * 60 + 59)).toBe(false);
    expect(capReached(30, 30 * 60)).toBe(true);
    expect(minutesLeftToday(30, 31 * 60)).toBe(0);
  });

  it("treats a cap of zero as no learning today", () => {
    expect(capReached(0, 0)).toBe(true);
    expect(minutesLeftToday(0, 0)).toBe(0);
  });
});

describe("quiet hours (UK time)", () => {
  const overnight = { quietStartMin: 21 * 60, quietEndMin: 7 * 60 };

  it("handles a window that runs past midnight", () => {
    expect(inQuietHours(new Date("2026-11-18T20:59:00Z"), overnight)).toBe(false);
    expect(inQuietHours(new Date("2026-11-18T21:00:00Z"), overnight)).toBe(true);
    expect(inQuietHours(new Date("2026-11-19T03:00:00Z"), overnight)).toBe(true);
    expect(inQuietHours(new Date("2026-11-19T06:59:00Z"), overnight)).toBe(true);
    expect(inQuietHours(new Date("2026-11-19T07:00:00Z"), overnight)).toBe(false);
  });

  it("uses London time, not UTC, in summer", () => {
    // 20:30 UTC on 1 July is 21:30 in London (BST).
    expect(inQuietHours(new Date("2026-07-01T20:30:00Z"), overnight)).toBe(true);
    // 06:30 UTC is 07:30 in London: quiet hours are over.
    expect(inQuietHours(new Date("2026-07-01T06:30:00Z"), overnight)).toBe(false);
  });

  it("means no quiet hours when the two ends are equal, and handles a daytime window", () => {
    expect(inQuietHours(new Date("2026-11-18T03:00:00Z"), { quietStartMin: 0, quietEndMin: 0 })).toBe(false);
    const schoolDay = { quietStartMin: 9 * 60, quietEndMin: 15 * 60 };
    expect(inQuietHours(new Date("2026-11-18T12:00:00Z"), schoolDay)).toBe(true);
    expect(inQuietHours(new Date("2026-11-18T15:00:00Z"), schoolDay)).toBe(false);
  });

  it("writes times as a 24-hour clock", () => {
    expect(minutesToClock(0)).toBe("00:00");
    expect(minutesToClock(7 * 60)).toBe("07:00");
    expect(minutesToClock(21 * 60 + 5)).toBe("21:05");
    expect(minutesToClock(1440)).toBe("00:00");
  });
});

describe("heartbeat seconds", () => {
  const base = { secondsSinceLast: null, capMinutes: null, usedSeconds: 0 };

  it("never credits more than one beat's worth, whatever the browser claims", () => {
    expect(creditableSeconds({ ...base, claimed: 30 })).toBe(30);
    expect(creditableSeconds({ ...base, claimed: 3600 })).toBe(HEARTBEAT_MAX_SECONDS);
    expect(creditableSeconds({ ...base, claimed: 29.9 })).toBe(29);
  });

  it("never credits more time than has really passed since the last beat", () => {
    expect(creditableSeconds({ ...base, claimed: 60, secondsSinceLast: 10 })).toBe(10);
    expect(creditableSeconds({ ...base, claimed: 60, secondsSinceLast: 0 })).toBe(0);
    // Two tabs open: the second tab's beat a moment later adds almost nothing.
    expect(creditableSeconds({ ...base, claimed: 30, secondsSinceLast: 0.4 })).toBe(0);
    // A clock that went backwards adds nothing either.
    expect(creditableSeconds({ ...base, claimed: 30, secondsSinceLast: -50 })).toBe(0);
  });

  it("stops at the cap", () => {
    expect(creditableSeconds({ ...base, claimed: 60, capMinutes: 30, usedSeconds: 29 * 60 + 30 })).toBe(30);
    expect(creditableSeconds({ ...base, claimed: 60, capMinutes: 30, usedSeconds: 30 * 60 })).toBe(0);
    expect(creditableSeconds({ ...base, claimed: 60, capMinutes: 30, usedSeconds: 40 * 60 })).toBe(0);
  });

  it("ignores nonsense", () => {
    for (const claimed of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(creditableSeconds({ ...base, claimed })).toBe(0);
  });
});

describe("week start for the parent summary", () => {
  it("is the Monday of the UK week", () => {
    expect(londonWeekStartKey(new Date("2026-11-18T15:00:00Z"))).toBe("2026-11-16");
    expect(londonWeekStartKey(new Date("2026-11-16T00:30:00Z"))).toBe("2026-11-16");
    expect(londonWeekStartKey(new Date("2026-11-22T23:59:00Z"))).toBe("2026-11-16");
    // 23:30 UTC on a summer Sunday is already Monday in London.
    expect(londonWeekStartKey(new Date("2026-07-05T23:30:00Z"))).toBe("2026-07-06");
  });
});
