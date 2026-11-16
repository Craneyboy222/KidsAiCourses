// @vitest-environment node
import { describe, expect, it } from "vitest";
import { evaluateFlag, normaliseRules, percentageBucket, ruleMatches } from "@/server/flags";

const flag = (rules: unknown, enabled = true) => ({ key: "coach.voice", enabled, rules });

describe("flag rules", () => {
  it("is off when the flag is unknown or disabled, whatever the rules say", () => {
    expect(evaluateFlag(null)).toBe(false);
    expect(evaluateFlag(undefined)).toBe(false);
    expect(evaluateFlag(flag([], false))).toBe(false);
    expect(evaluateFlag(flag({ safetyBands: ["adult_18"] }, false), { safetyBand: "adult_18" })).toBe(false);
  });

  it("is on for everyone when enabled with no rules", () => {
    expect(evaluateFlag(flag([]))).toBe(true);
    expect(evaluateFlag(flag({}))).toBe(true);
    expect(evaluateFlag(flag(null))).toBe(true);
  });

  it("targets by safety band", () => {
    const f = flag({ safetyBands: ["teen_16_17", "adult_18"] });
    expect(evaluateFlag(f, { safetyBand: "adult_18" })).toBe(true);
    expect(evaluateFlag(f, { safetyBand: "teen_13_15" })).toBe(false);
    expect(evaluateFlag(f, {})).toBe(false);
  });

  it("targets by plan and by family", () => {
    expect(evaluateFlag(flag({ plans: ["family"] }), { plan: "family" })).toBe(true);
    expect(evaluateFlag(flag({ plans: ["family"] }), { plan: "free" })).toBe(false);
    expect(evaluateFlag(flag({ familyIds: ["fam-1"] }), { familyId: "fam-1" })).toBe(true);
    expect(evaluateFlag(flag({ familyIds: ["fam-1"] }), { familyId: "fam-2" })).toBe(false);
  });

  it("needs every condition inside one rule to match", () => {
    const f = flag({ safetyBands: ["adult_18"], plans: ["family"] });
    expect(evaluateFlag(f, { safetyBand: "adult_18", plan: "family" })).toBe(true);
    expect(evaluateFlag(f, { safetyBand: "adult_18", plan: "free" })).toBe(false);
  });

  it("is on when any rule in a list matches", () => {
    const f = flag([{ familyIds: ["beta-family"] }, { safetyBands: ["adult_18"], plans: ["family"] }]);
    expect(evaluateFlag(f, { familyId: "beta-family", safetyBand: "teen_13_15" })).toBe(true);
    expect(evaluateFlag(f, { familyId: "other", safetyBand: "adult_18", plan: "family" })).toBe(true);
    expect(evaluateFlag(f, { familyId: "other", safetyBand: "teen_13_15", plan: "family" })).toBe(false);
  });

  it("a condition this code does not know matches nobody (the rule shape is open, the answer is closed)", () => {
    expect(evaluateFlag(flag({ schoolIds: ["s1"] }), { familyId: "f" })).toBe(false);
    expect(
      evaluateFlag(flag({ safetyBands: ["adult_18"], somethingNew: true }), { safetyBand: "adult_18" }),
    ).toBe(false);
    // …but another rule in the list can still match.
    expect(evaluateFlag(flag([{ schoolIds: ["s1"] }, { plans: ["family"] }]), { plan: "family" })).toBe(true);
  });

  it("an empty list in a condition matches nobody", () => {
    expect(evaluateFlag(flag({ safetyBands: [] }), { safetyBand: "adult_18" })).toBe(false);
  });

  it("percentage is stable per family and roughly the right share", () => {
    expect(percentageBucket("coach.voice", "fam-1")).toBe(percentageBucket("coach.voice", "fam-1"));
    const ids = Array.from({ length: 2000 }, (_, i) => `family-${i}`);
    const on = ids.filter((id) => ruleMatches("coach.voice", { percentage: 25 }, { familyId: id })).length;
    expect(on).toBeGreaterThan(400);
    expect(on).toBeLessThan(600);
    // Everyone who was in at 25% is still in at 50%.
    for (const id of ids.slice(0, 300)) {
      if (ruleMatches("coach.voice", { percentage: 25 }, { familyId: id }))
        expect(ruleMatches("coach.voice", { percentage: 50 }, { familyId: id })).toBe(true);
    }
  });

  it("percentage 0 is nobody, 100 is everybody, and no id means out", () => {
    expect(ruleMatches("k", { percentage: 0 }, { familyId: "f" })).toBe(false);
    expect(ruleMatches("k", { percentage: 100 }, {})).toBe(true);
    expect(ruleMatches("k", { percentage: 99 }, {})).toBe(false);
    expect(ruleMatches("k", { percentage: "50" as never }, { familyId: "f" })).toBe(false);
  });

  it("keeps a family together: the family id decides before the user id", () => {
    const rule = { percentage: 50 };
    const a = ruleMatches("k", rule, { familyId: "fam-9", userId: "child-a" });
    const b = ruleMatches("k", rule, { familyId: "fam-9", userId: "child-b" });
    expect(a).toBe(b);
  });

  it("normaliseRules accepts one rule or a list and drops junk", () => {
    expect(normaliseRules({ plans: ["family"] })).toEqual([{ plans: ["family"] }]);
    expect(normaliseRules([{ plans: ["family"] }, "nope", null, 3])).toEqual([{ plans: ["family"] }]);
    expect(normaliseRules("nope")).toEqual([]);
  });
});
