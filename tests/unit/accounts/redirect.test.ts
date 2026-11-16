import { describe, expect, it } from "vitest";
import {
  TWO_FACTOR_PATH,
  TWO_FACTOR_SETUP_PATH,
  WAITING_PATH,
  chooseAfterSignInPath,
  homePathFor,
  type SignedInFacts,
} from "@/server/services/sign-in";

const learner = (over: Partial<Extract<SignedInFacts, { kind: "learner" }>> = {}): SignedInFacts => ({
  kind: "learner",
  status: "active",
  onboardingCompleted: true,
  ...over,
});
const parent = (hasChildren: boolean): SignedInFacts => ({ kind: "parent", hasChildren });
const staff = (twoFactorEnabled: boolean, twoFactorVerified: boolean): SignedInFacts => ({ kind: "staff", twoFactorEnabled, twoFactorVerified });

describe("homePathFor: where each kind of user lands", () => {
  it("sends a learner to onboarding first, then home", () => {
    expect(homePathFor(learner({ onboardingCompleted: false }))).toBe("/onboarding");
    expect(homePathFor(learner())).toBe("/home");
  });

  it("sends a teen who is waiting for a parent to the waiting page", () => {
    expect(homePathFor(learner({ status: "pending_parent", onboardingCompleted: false }))).toBe(WAITING_PATH);
  });

  it("sends a paused learner home, where the pause is explained, not to onboarding", () => {
    expect(homePathFor(learner({ status: "paused", onboardingCompleted: false }))).toBe("/home");
  });

  it("sends a parent to onboarding until they have a child, then the dashboard", () => {
    expect(homePathFor(parent(false))).toBe("/parent/onboarding");
    expect(homePathFor(parent(true))).toBe("/parent");
  });

  it("sends staff to set up or enter their two-step code before Studio", () => {
    expect(homePathFor(staff(false, false))).toBe(TWO_FACTOR_SETUP_PATH);
    expect(homePathFor(staff(true, false))).toBe(TWO_FACTOR_PATH);
    expect(homePathFor(staff(true, true))).toBe("/studio");
  });

  it("lets staff straight in when two-step is switched off for local development (verified without enrolment)", () => {
    expect(homePathFor(staff(false, true))).toBe("/studio");
  });

  it("sends anyone signed out to sign in", () => {
    expect(homePathFor({ kind: "anonymous" })).toBe("/signin");
  });
});

describe("chooseAfterSignInPath: honouring ?next= safely", () => {
  it("returns a learner to a learner page they asked for", () => {
    expect(chooseAfterSignInPath(learner(), "/explore/build-your-own-app")).toBe("/explore/build-your-own-app");
    expect(chooseAfterSignInPath(learner(), "/settings/independence?token=abc")).toBe("/settings/independence?token=abc");
  });

  it("never sends a learner to a parent or staff page because a link said so", () => {
    expect(chooseAfterSignInPath(learner(), "/parent/billing")).toBe("/home");
    expect(chooseAfterSignInPath(learner(), "/studio")).toBe("/home");
    expect(chooseAfterSignInPath(learner(), "/pricing")).toBe("/home");
  });

  it("makes a learner finish onboarding or waiting first", () => {
    expect(chooseAfterSignInPath(learner({ onboardingCompleted: false }), "/explore")).toBe("/onboarding");
    expect(chooseAfterSignInPath(learner({ status: "pending_parent" }), "/home")).toBe(WAITING_PATH);
  });

  it("returns a parent to a parent page, and to an approval link even before they have a child", () => {
    expect(chooseAfterSignInPath(parent(true), "/parent/approvals")).toBe("/parent/approvals");
    expect(chooseAfterSignInPath(parent(false), "/approve/some-token")).toBe("/approve/some-token");
    expect(chooseAfterSignInPath(parent(true), "/home")).toBe("/parent");
    expect(chooseAfterSignInPath(parent(false), "/studio/users")).toBe("/parent/onboarding");
  });

  it("returns staff to a Studio page only once two-step is done", () => {
    expect(chooseAfterSignInPath(staff(true, true), "/studio/review")).toBe("/studio/review");
    expect(chooseAfterSignInPath(staff(true, false), "/studio/review")).toBe(TWO_FACTOR_PATH);
    expect(chooseAfterSignInPath(staff(false, false), "/studio/review")).toBe(TWO_FACTOR_SETUP_PATH);
    expect(chooseAfterSignInPath(staff(true, true), "/parent")).toBe("/studio");
  });

  it("can never be used to send someone to another website", () => {
    for (const next of ["https://evil.example", "//evil.example/home", "/\\evil.example", "javascript:alert(1)", "home", "/home\nSet-Cookie: x=1", ""]) {
      expect(chooseAfterSignInPath(learner(), next), JSON.stringify(next)).toBe("/home");
      expect(chooseAfterSignInPath(parent(true), next), JSON.stringify(next)).toBe("/parent");
    }
    expect(chooseAfterSignInPath(learner(), null)).toBe("/home");
    expect(chooseAfterSignInPath(learner(), undefined)).toBe("/home");
  });

  it("is not fooled by the case of the first segment", () => {
    expect(chooseAfterSignInPath(learner(), "/Parent")).toBe("/home");
    expect(chooseAfterSignInPath(parent(true), "/PARENT/notices")).toBe("/PARENT/notices");
  });
});
