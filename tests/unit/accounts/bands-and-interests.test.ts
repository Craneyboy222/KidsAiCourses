import { describe, expect, it } from "vitest";
import { INTEREST_TAGS } from "@/content/schema";
import { INTEREST_LABELS, MIN_INTERESTS, cleanInterests, newAvatarChoices } from "@/server/services/onboarding";
import { bandUpdateFor } from "@/server/services/safety-band";

const at = (iso: string) => new Date(iso);

describe("bandUpdateFor", () => {
  it("moves a learner up only once the birth month is completely over", () => {
    const profile = { birthYear: 2010, birthMonth: 11, safetyBand: "teen_13_15" as const, pathway: "ks4" as const };
    // All through November 2026 they may still be 15.
    expect(bandUpdateFor(profile, at("2026-11-30T23:00:00Z"))).toMatchObject({ age: 15, safetyBand: "teen_13_15", bandChanged: false, movedUp: false });
    expect(bandUpdateFor(profile, at("2026-12-01T00:30:00Z"))).toMatchObject({ age: 16, safetyBand: "teen_16_17", bandChanged: true, movedUp: true, pathway: "ks4", pathwayChanged: false });
  });

  it("reaches adult_18 and the sixth-form pathway at the right ages", () => {
    const profile = { birthYear: 2008, birthMonth: 5, safetyBand: "teen_16_17" as const, pathway: "ks4" as const };
    expect(bandUpdateFor(profile, at("2025-06-01T09:00:00Z"))).toMatchObject({ age: 17, safetyBand: "teen_16_17", pathway: "sixth_form", pathwayChanged: true, bandChanged: false });
    expect(bandUpdateFor(profile, at("2026-06-01T09:00:00Z"))).toMatchObject({ age: 18, safetyBand: "adult_18", bandChanged: true, movedUp: true });
  });

  it("reports a correction downwards as a change but not as moving up", () => {
    const profile = { birthYear: 2012, birthMonth: 3, safetyBand: "teen_16_17" as const, pathway: "ks4" as const };
    expect(bandUpdateFor(profile, at("2026-11-16T09:00:00Z"))).toMatchObject({ age: 14, safetyBand: "teen_13_15", bandChanged: true, movedUp: false, pathway: "ks3", pathwayChanged: true });
  });

  it("changes nothing for a birth date that now gives an age under 13", () => {
    const profile = { birthYear: 2015, birthMonth: 1, safetyBand: "teen_13_15" as const, pathway: "ks3" as const };
    expect(bandUpdateFor(profile, at("2026-11-16T09:00:00Z"))).toEqual({ age: 11, safetyBand: null, pathway: null, bandChanged: false, movedUp: false, pathwayChanged: false });
  });
});

describe("onboarding helpers", () => {
  it("has a label for each of the 16 interest tags", () => {
    expect(INTEREST_TAGS).toHaveLength(16);
    expect(Object.keys(INTEREST_LABELS).sort()).toEqual([...INTEREST_TAGS].sort());
  });

  it("keeps only real tags, once each", () => {
    expect(cleanInterests(["music", "Music ", "games", "not-a-tag", "<script>", "apps"])).toEqual(["music", "games", "apps"]);
    expect(cleanInterests([])).toEqual([]);
    expect(MIN_INTERESTS).toBe(3);
  });

  it("makes avatar choices that are random seeds and nothing else", () => {
    const choices = newAvatarChoices(6);
    expect(choices).toHaveLength(6);
    expect(new Set(choices).size).toBe(6);
    for (const seed of choices) expect(seed).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
});
