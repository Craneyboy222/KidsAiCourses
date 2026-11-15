import { describe, expect, it } from "vitest";
import {
  ageFromBirth,
  isUnder13,
  pathwayForAge,
  safetyBandForAge,
  stricterBand,
} from "@/server/services/age";

/** A moment given as London wall-clock time is easier to read than UTC, so build dates from ISO strings with an offset. */
const at = (iso: string) => new Date(iso);

describe("ageFromBirth", () => {
  it("counts the birthday only once the birth month is over (the younger reading)", () => {
    // Born November 2013. We do not know the day, so all through November 2026 they may still be 12.
    expect(ageFromBirth(2013, 11, at("2026-10-31T12:00:00Z"))).toBe(12);
    expect(ageFromBirth(2013, 11, at("2026-11-01T00:00:00Z"))).toBe(12);
    expect(ageFromBirth(2013, 11, at("2026-11-15T12:00:00Z"))).toBe(12);
    expect(ageFromBirth(2013, 11, at("2026-11-30T23:59:59Z"))).toBe(12);
    // From the first moment of December they are certainly 13.
    expect(ageFromBirth(2013, 11, at("2026-12-01T00:00:00Z"))).toBe(13);
  });

  it("never reports an age older than the true age, whatever the day of birth", () => {
    // True age if born on the last day of the month is the lowest possible; we must not exceed it.
    for (let birthMonth = 1; birthMonth <= 12; birthMonth++) {
      for (let month = 1; month <= 12; month++) {
        const now = new Date(Date.UTC(2026, month - 1, 15, 12));
        const lastDayOfBirthMonth = new Date(Date.UTC(2012, birthMonth, 0));
        let trueMinimumAge = 2026 - 2012;
        const birthdayThisYear = new Date(Date.UTC(2026, birthMonth - 1, lastDayOfBirthMonth.getUTCDate()));
        if (now < birthdayThisYear) trueMinimumAge -= 1;
        expect(ageFromBirth(2012, birthMonth, now)).toBeLessThanOrEqual(trueMinimumAge);
      }
    }
  });

  it("handles a December birth month across the year boundary", () => {
    expect(ageFromBirth(2013, 12, at("2026-12-31T23:59:59Z"))).toBe(12);
    expect(ageFromBirth(2013, 12, at("2027-01-01T00:00:00Z"))).toBe(13);
  });

  it("handles a January birth month", () => {
    expect(ageFromBirth(2013, 1, at("2026-01-31T23:59:59Z"))).toBe(12);
    expect(ageFromBirth(2013, 1, at("2026-02-01T00:00:00Z"))).toBe(13);
    expect(ageFromBirth(2013, 1, at("2026-12-31T23:59:59Z"))).toBe(13);
  });

  it("uses the month in Europe/London, not UTC, during British Summer Time", () => {
    // Born June 2013. 30 June 2026 23:30 UTC is already 1 July 00:30 in London (BST).
    expect(ageFromBirth(2013, 6, at("2026-06-30T22:59:59Z"))).toBe(12); // 23:59:59 BST, still June
    expect(ageFromBirth(2013, 6, at("2026-06-30T23:00:00Z"))).toBe(13); // 00:00 BST on 1 July
    expect(ageFromBirth(2013, 6, at("2026-06-30T23:30:00Z"))).toBe(13);
  });

  it("uses London time in winter too, when London is on GMT", () => {
    expect(ageFromBirth(2013, 2, at("2026-02-28T23:59:59Z"))).toBe(12);
    expect(ageFromBirth(2013, 2, at("2026-03-01T00:00:00Z"))).toBe(13);
  });

  it("is not fooled by the server's own time zone offset in the input", () => {
    // The same instant written with a +13:00 offset: 1 December in Auckland, still 30 November in London.
    expect(ageFromBirth(2013, 11, at("2026-12-01T05:00:00+13:00"))).toBe(12);
  });

  it("gives a negative age for a birth month in the future", () => {
    expect(ageFromBirth(2027, 3, at("2026-11-15T12:00:00Z"))).toBeLessThan(0);
  });

  it("rejects a birth month or year that is not a sensible whole number", () => {
    const now = at("2026-11-15T12:00:00Z");
    expect(() => ageFromBirth(2013, 0, now)).toThrow(RangeError);
    expect(() => ageFromBirth(2013, 13, now)).toThrow(RangeError);
    expect(() => ageFromBirth(2013, 6.5, now)).toThrow(RangeError);
    expect(() => ageFromBirth(13, 6, now)).toThrow(RangeError);
    expect(() => ageFromBirth(Number.NaN, 6, now)).toThrow(RangeError);
  });
});

describe("isUnder13", () => {
  const now = at("2026-11-15T12:00:00Z");

  it("blocks a child whose 13th birthday falls in the current month, because it may not have happened yet", () => {
    expect(isUnder13(2013, 11, now)).toBe(true);
  });

  it("blocks a child whose 13th birthday is still to come", () => {
    expect(isUnder13(2013, 12, now)).toBe(true);
    expect(isUnder13(2014, 1, now)).toBe(true);
    expect(isUnder13(2020, 5, now)).toBe(true);
  });

  it("allows a child whose 13th birthday month is over", () => {
    expect(isUnder13(2013, 10, now)).toBe(false);
    expect(isUnder13(2013, 1, now)).toBe(false);
    expect(isUnder13(2010, 11, now)).toBe(false);
  });

  it("blocks a birth date in the future", () => {
    expect(isUnder13(2030, 1, now)).toBe(true);
  });
});

describe("safetyBandForAge", () => {
  it("has no band under 13", () => {
    expect(safetyBandForAge(12)).toBeNull();
    expect(safetyBandForAge(0)).toBeNull();
    expect(safetyBandForAge(-1)).toBeNull();
  });

  it("maps each age to its band at the boundaries", () => {
    expect(safetyBandForAge(13)).toBe("teen_13_15");
    expect(safetyBandForAge(15)).toBe("teen_13_15");
    expect(safetyBandForAge(16)).toBe("teen_16_17");
    expect(safetyBandForAge(17)).toBe("teen_16_17");
    expect(safetyBandForAge(18)).toBe("adult_18");
    expect(safetyBandForAge(40)).toBe("adult_18");
  });

  it("keeps a learner in the stricter band for the whole of their 16th and 18th birthday months", () => {
    // Born November 2010: turns 16 some time in November 2026.
    expect(safetyBandForAge(ageFromBirth(2010, 11, at("2026-11-20T12:00:00Z")))).toBe("teen_13_15");
    expect(safetyBandForAge(ageFromBirth(2010, 11, at("2026-12-01T00:00:00Z")))).toBe("teen_16_17");
    // Born November 2008: turns 18 some time in November 2026.
    expect(safetyBandForAge(ageFromBirth(2008, 11, at("2026-11-20T12:00:00Z")))).toBe("teen_16_17");
    expect(safetyBandForAge(ageFromBirth(2008, 11, at("2026-12-01T00:00:00Z")))).toBe("adult_18");
  });
});

describe("pathwayForAge", () => {
  it("has no pathway under 13", () => {
    expect(pathwayForAge(12)).toBeNull();
  });

  it("maps 13–14 to ks3, 15–16 to ks4 and 17–18 to sixth_form", () => {
    expect(pathwayForAge(13)).toBe("ks3");
    expect(pathwayForAge(14)).toBe("ks3");
    expect(pathwayForAge(15)).toBe("ks4");
    expect(pathwayForAge(16)).toBe("ks4");
    expect(pathwayForAge(17)).toBe("sixth_form");
    expect(pathwayForAge(18)).toBe("sixth_form");
  });

  it("keeps adults on sixth_form", () => {
    expect(pathwayForAge(25)).toBe("sixth_form");
  });
});

describe("stricterBand", () => {
  it("returns the younger of two bands, in either order", () => {
    expect(stricterBand("teen_13_15", "teen_16_17")).toBe("teen_13_15");
    expect(stricterBand("teen_16_17", "teen_13_15")).toBe("teen_13_15");
    expect(stricterBand("adult_18", "teen_16_17")).toBe("teen_16_17");
    expect(stricterBand("adult_18", "adult_18")).toBe("adult_18");
  });
});
