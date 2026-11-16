import { describe, expect, it } from "vitest";
import {
  AGE_ASSURANCE_ORDER,
  decideAgeAssurance,
  type AgeAssuranceFacts,
  type AgeAssuranceLevel,
  type AgeAssuranceMode,
} from "@/server/services/age-assurance";
import type { SafetyBand } from "@/server/authz/actor";

const facts = (over: Partial<AgeAssuranceFacts>): AgeAssuranceFacts => ({
  mode: "card_or_subscription",
  band: "teen_13_15",
  familyLevel: "none",
  parentEmailVerified: false,
  consentComplete: false,
  appEnv: "production",
  ...over,
});

describe("decideAgeAssurance: the decision table", () => {
  type Row = [AgeAssuranceMode, SafetyBand, AgeAssuranceLevel, boolean, boolean, boolean, string[]];
  // mode, band, family level, parent email verified, consent complete → satisfied, missing
  const table: Row[] = [
    // 13–15 with card_or_subscription: a card check or a paid subscription, plus consent.
    ["card_or_subscription", "teen_13_15", "none", true, true, false, ["card_or_subscription"]],
    ["card_or_subscription", "teen_13_15", "parent_email", true, true, false, ["card_or_subscription"]],
    ["card_or_subscription", "teen_13_15", "card_authorisation", false, true, true, []],
    ["card_or_subscription", "teen_13_15", "paid_subscription", false, true, true, []],
    ["card_or_subscription", "teen_13_15", "card_authorisation", true, false, false, ["consent"]],
    ["card_or_subscription", "teen_13_15", "none", false, false, false, ["card_or_subscription", "consent"]],
    // 16–17: the parent's verified email and consent.
    ["card_or_subscription", "teen_16_17", "none", true, true, true, []],
    ["card_or_subscription", "teen_16_17", "none", false, true, false, ["parent_email"]],
    ["card_or_subscription", "teen_16_17", "none", true, false, false, ["consent"]],
    ["card_or_subscription", "teen_16_17", "none", false, false, false, ["parent_email", "consent"]],
    // A card check is stronger evidence of an adult than an email, so it also satisfies 16–17.
    ["card_or_subscription", "teen_16_17", "card_authorisation", false, true, true, []],
    // 18: nothing more, in every mode and whatever else is true.
    ["card_or_subscription", "adult_18", "none", false, false, true, []],
    ["parent_email", "adult_18", "none", false, false, true, []],
    // parent_email mode: a verified parent email and consent for both teen bands.
    ["parent_email", "teen_13_15", "none", true, true, true, []],
    ["parent_email", "teen_13_15", "none", false, true, false, ["parent_email"]],
    ["parent_email", "teen_13_15", "none", true, false, false, ["consent"]],
    ["parent_email", "teen_16_17", "none", true, true, true, []],
  ];

  it.each(table)("%s · %s · level %s · email %s · consent %s → %s", (mode, band, familyLevel, parentEmailVerified, consentComplete, satisfied, missing) => {
    expect(decideAgeAssurance(facts({ mode, band, familyLevel, parentEmailVerified, consentComplete }))).toEqual({ satisfied, missing });
  });

  it("honours off_dev_only on a developer's machine and in tests only", () => {
    for (const appEnv of ["local", "test"] as const) {
      expect(decideAgeAssurance(facts({ mode: "off_dev_only", appEnv }))).toEqual({ satisfied: true, missing: [] });
    }
  });

  it("fails closed if off_dev_only is ever left on in preview or production", () => {
    for (const appEnv of ["preview", "production"] as const) {
      expect(decideAgeAssurance(facts({ mode: "off_dev_only", appEnv, parentEmailVerified: true, consentComplete: true }))).toEqual({
        satisfied: false,
        missing: ["card_or_subscription"],
      });
    }
  });

  it("orders the levels from weakest to strongest", () => {
    expect(AGE_ASSURANCE_ORDER).toEqual(["none", "parent_email", "card_authorisation", "paid_subscription"]);
  });
});
