import { describe, expect, it } from "vitest";
import { DEFAULT_SLA_HOURS, parseClock, slaDueAt, slaDueFor } from "@/server/services/moderation-sla";

const WINDOW = { start: "08:00", end: "22:00" };
/** Mid-November: UK time is UTC. */
const utc = (value: string) => new Date(`${value}:00Z`);

describe("parseClock", () => {
  it("reads a time of day in minutes", () => {
    expect(parseClock("08:00")).toBe(480);
    expect(parseClock("22:30")).toBe(1350);
    expect(parseClock("24:00")).toBe(1440);
    expect(parseClock("8am")).toBeNull();
    expect(parseClock("25:00")).toBeNull();
  });
});

describe("slaDueAt counts time inside the working window only", () => {
  it("adds the hours directly when they fit in today's window", () => {
    expect(slaDueAt(utc("2026-11-18T10:00"), 4, WINDOW)).toEqual(utc("2026-11-18T14:00"));
    expect(slaDueAt(utc("2026-11-18T08:00"), 8, WINDOW)).toEqual(utc("2026-11-18T16:00"));
  });

  it("carries what is left over to the next morning", () => {
    // 21:00 + 8h: one hour today, seven tomorrow from 08:00.
    expect(slaDueAt(utc("2026-11-18T21:00"), 8, WINDOW)).toEqual(utc("2026-11-19T15:00"));
    // Critical, raised at 20:30: 1.5h today, 2.5h tomorrow.
    expect(slaDueAt(utc("2026-11-18T20:30"), 4, WINDOW)).toEqual(utc("2026-11-19T10:30"));
  });

  it("starts the clock at opening time for something raised overnight", () => {
    expect(slaDueAt(utc("2026-11-18T23:15"), 4, WINDOW)).toEqual(utc("2026-11-19T12:00"));
    expect(slaDueAt(utc("2026-11-18T03:00"), 4, WINDOW)).toEqual(utc("2026-11-18T12:00"));
  });

  it("spreads a 48-hour target over several 14-hour days", () => {
    // From 08:00: 14 + 14 + 14 = 42 hours by the end of day three, six more on day four.
    expect(slaDueAt(utc("2026-11-16T08:00"), 48, WINDOW)).toEqual(utc("2026-11-19T14:00"));
    // From 15:00: 7 + 14 + 14 = 35, then 13 more.
    expect(slaDueAt(utc("2026-11-16T15:00"), 48, WINDOW)).toEqual(utc("2026-11-19T21:00"));
  });

  it("lands exactly on closing time rather than rolling over", () => {
    expect(slaDueAt(utc("2026-11-18T18:00"), 4, WINDOW)).toEqual(utc("2026-11-18T22:00"));
  });

  it("uses UK time, so the window moves with the clocks", () => {
    // 1 July: UK is UTC+1, so 08:00–22:00 UK is 07:00–21:00 UTC.
    expect(slaDueAt(utc("2026-07-01T20:00"), 4, WINDOW)).toEqual(utc("2026-07-02T10:00"));
    // The night the clocks go back (25 October 2026): the next window still opens at 08:00 UK, which is 08:00 UTC.
    expect(slaDueAt(utc("2026-10-24T20:00"), 4, WINDOW)).toEqual(utc("2026-10-25T11:00"));
  });

  it("handles part-hours", () => {
    expect(slaDueAt(utc("2026-11-18T10:00"), 0.5, WINDOW)).toEqual(utc("2026-11-18T10:30"));
  });

  it("never gives longer than the target when the window is unusable", () => {
    const from = utc("2026-11-18T23:00");
    expect(slaDueAt(from, 4, { start: "22:00", end: "08:00" })).toEqual(utc("2026-11-19T03:00"));
    expect(slaDueAt(from, 4, { start: "nonsense", end: "22:00" })).toEqual(utc("2026-11-19T03:00"));
    expect(slaDueAt(from, 4, { start: "09:00", end: "09:00" })).toEqual(utc("2026-11-19T03:00"));
  });
});

describe("slaDueFor", () => {
  it("uses the sole-operator defaults: 4, 8 and 48 hours", () => {
    const from = utc("2026-11-18T09:00");
    expect(DEFAULT_SLA_HOURS).toEqual({ critical: 4, high: 8, normal: 48 });
    expect(slaDueFor(from, "critical")).toEqual(utc("2026-11-18T13:00"));
    expect(slaDueFor(from, "high")).toEqual(utc("2026-11-18T17:00"));
    expect(slaDueFor(from, "normal")).toEqual(utc("2026-11-21T15:00"));
  });

  it("orders deadlines by severity for items raised together", () => {
    const from = utc("2026-11-18T21:30");
    const due = (["critical", "high", "normal"] as const).map((severity) => slaDueFor(from, severity).getTime());
    expect(due[0]).toBeLessThan(due[1] ?? 0);
    expect(due[1]).toBeLessThan(due[2] ?? 0);
  });
});
