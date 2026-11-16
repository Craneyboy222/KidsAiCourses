// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  effectiveQuietWindow,
  hhmmToMinutes,
  isQuietNow,
  quietHoursDeliverAfter,
} from "@/server/notifications/quiet-hours";

const night = { startMin: 21 * 60, endMin: 7 * 60 }; // 21:00–07:00
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("quietHoursDeliverAfter", () => {
  it("is immediate outside the window", () => {
    expect(quietHoursDeliverAfter(new Date("2026-11-16T15:00:00Z"), night)).toBeNull();
    expect(quietHoursDeliverAfter(new Date("2026-11-16T07:00:00Z"), night)).toBeNull();
    expect(quietHoursDeliverAfter(new Date("2026-11-16T20:59:59Z"), night)).toBeNull();
  });

  it("waits until 07:00 the next morning when raised in the evening (winter, GMT)", () => {
    expect(iso(quietHoursDeliverAfter(new Date("2026-11-16T21:00:00Z"), night))).toBe(
      "2026-11-17T07:00:00.000Z",
    );
    expect(iso(quietHoursDeliverAfter(new Date("2026-11-16T23:30:00Z"), night))).toBe(
      "2026-11-17T07:00:00.000Z",
    );
  });

  it("waits until 07:00 the same morning when raised after midnight", () => {
    expect(iso(quietHoursDeliverAfter(new Date("2026-11-17T02:15:00Z"), night))).toBe(
      "2026-11-17T07:00:00.000Z",
    );
    expect(iso(quietHoursDeliverAfter(new Date("2026-11-17T06:59:30Z"), night))).toBe(
      "2026-11-17T07:00:00.000Z",
    );
  });

  it("uses UK time in summer (BST is an hour ahead of UTC)", () => {
    // 20:30 UTC is 21:30 in London in July: inside the window. It ends at 07:00 BST = 06:00 UTC.
    expect(iso(quietHoursDeliverAfter(new Date("2026-07-01T20:30:00Z"), night))).toBe(
      "2026-07-02T06:00:00.000Z",
    );
    // 20:30 London time (19:30 UTC) is still before the window.
    expect(quietHoursDeliverAfter(new Date("2026-07-01T19:30:00Z"), night)).toBeNull();
  });

  it("gets the morning right across the clock change in March", () => {
    // Saturday 28 March 2026, 22:00 GMT. Clocks go forward overnight, so 07:00 on Sunday is 06:00 UTC.
    expect(iso(quietHoursDeliverAfter(new Date("2026-03-28T22:00:00Z"), night))).toBe(
      "2026-03-29T06:00:00.000Z",
    );
  });

  it("gets the morning right across the clock change in October", () => {
    // Saturday 24 October 2026, 22:00 BST (21:00 UTC). Clocks go back overnight, so 07:00 on Sunday is 07:00 UTC.
    expect(iso(quietHoursDeliverAfter(new Date("2026-10-24T21:00:00Z"), night))).toBe(
      "2026-10-25T07:00:00.000Z",
    );
  });

  it("handles a window that does not cross midnight", () => {
    const afternoon = { startMin: 13 * 60, endMin: 15 * 60 };
    expect(iso(quietHoursDeliverAfter(new Date("2026-11-16T13:30:00Z"), afternoon))).toBe(
      "2026-11-16T15:00:00.000Z",
    );
    expect(quietHoursDeliverAfter(new Date("2026-11-16T15:00:00Z"), afternoon)).toBeNull();
  });

  it("has no quiet time when there is no window", () => {
    expect(quietHoursDeliverAfter(new Date("2026-11-16T23:00:00Z"), null)).toBeNull();
    expect(isQuietNow(new Date("2026-11-16T23:00:00Z"), null)).toBe(false);
  });
});

describe("effectiveQuietWindow", () => {
  const siteDefault = { start: "21:00", end: "07:00" };

  it("uses the parent's choice when both ends are set", () => {
    expect(effectiveQuietWindow({ quietStartMin: 1200, quietEndMin: 480 }, siteDefault)).toEqual({
      startMin: 1200,
      endMin: 480,
    });
  });

  it("falls back to the site default when the parent has not chosen, or has only half chosen", () => {
    expect(effectiveQuietWindow(null, siteDefault)).toEqual(night);
    expect(effectiveQuietWindow({ quietStartMin: null, quietEndMin: null }, siteDefault)).toEqual(night);
    expect(effectiveQuietWindow({ quietStartMin: 1200, quietEndMin: null }, siteDefault)).toEqual(night);
  });

  it("treats start equal to end as quiet hours switched off", () => {
    expect(effectiveQuietWindow({ quietStartMin: 0, quietEndMin: 0 }, siteDefault)).toBeNull();
    expect(effectiveQuietWindow(null, { start: "08:00", end: "08:00" })).toBeNull();
  });

  it("ignores values that are not minutes of a day", () => {
    expect(effectiveQuietWindow({ quietStartMin: -5, quietEndMin: 2000 }, siteDefault)).toEqual(night);
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("07:05")).toBe(425);
  });
});
