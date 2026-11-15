import { describe, expect, it } from "vitest";
import { ACTIONS, can, assertCan, type Action, type Actor, type StaffRole } from "@/server/authz";

const learnerA: Actor = { type: "learner", userId: "learner-a", familyId: "fam-1", safetyBand: "teen_13_15", age: 14, status: "active" };
const learnerB: Actor = { type: "learner", userId: "learner-b", familyId: "fam-2", safetyBand: "teen_16_17", age: 16, status: "active" };
const parent1: Actor = { type: "parent", userId: "parent-1", familyId: "fam-1", status: "active" };
const parent2: Actor = { type: "parent", userId: "parent-2", familyId: "fam-2", status: "active" };
const staff = (roles: StaffRole[], twoFactorVerified = true): Actor => ({ type: "staff", userId: "staff-1", roles, twoFactorVerified });
const anon: Actor = { type: "anonymous" };
const system: Actor = { type: "system", job: "test" };

const ownA = { learnerId: "learner-a", familyId: "fam-1" };
const allActions = Object.keys(ACTIONS) as Action[];

describe("authz: learner isolation (spec Section 9: learner A cannot read learner B's anything)", () => {
  it.each(allActions)("learner B can never perform %s on learner A's records", (action) => {
    expect(can(learnerB, action, ownA)).toBe(false);
  });
  it.each(allActions)("parent of another family can never perform %s on learner A's records", (action) => {
    expect(can(parent2, action, ownA)).toBe(false);
  });
  it.each(allActions)("%s is denied to a learner when no owner is given", (action) => {
    expect(can(learnerA, action, {})).toBe(false);
  });
  it("a learner can read their own portfolio and their parent can too", () => {
    expect(can(learnerA, "learner.portfolio.read", ownA)).toBe(true);
    expect(can(parent1, "learner.portfolio.read", ownA)).toBe(true);
  });
  it("a parent cannot read tutor transcripts, only the summary (spec 3.6)", () => {
    expect(can(parent1, "learner.coach.history.read", ownA)).toBe(false);
    expect(can(parent1, "learner.coach.summary.read", ownA)).toBe(true);
  });
});

describe("authz: anonymous", () => {
  const allowed = allActions.filter((a) => can(anon, a, ownA));
  it("only public and sign-up actions are open when signed out", () => {
    expect(allowed.sort()).toEqual(
      ["public.catalogue.read", "public.certificate.verify", "signup.approve_teen", "signup.parent", "signup.teen"].sort(),
    );
  });
});

describe("authz: paused and pending accounts", () => {
  const paused: Actor = { ...learnerA, status: "paused" } as Actor;
  const pending: Actor = { ...learnerA, status: "pending_parent" } as Actor;
  it("a paused learner cannot learn, submit or use Coach", () => {
    for (const a of ["learner.course.start", "learner.progress.write", "learner.submission.create", "learner.coach.chat"] as Action[]) {
      expect(can(paused, a, ownA)).toBe(false);
      expect(can(pending, a, ownA)).toBe(false);
    }
  });
  it("a paused learner can still report a concern and change accessibility settings", () => {
    expect(can(paused, "report.create", ownA)).toBe(true);
    expect(can(paused, "learner.settings.update", ownA)).toBe(true);
  });
  it("explains the pause rather than saying forbidden", () => {
    expect(() => assertCan(paused, "learner.coach.chat", ownA)).toThrowError(/paused/);
  });
});

describe("authz: staff", () => {
  it.each(allActions)("staff without a verified second factor can never perform %s", (action) => {
    expect(can(staff(["super_admin"], false), action, ownA)).toBe(false);
  });
  it("super_admin can do everything staff can do", () => {
    const staffActions = allActions.filter((a) => "staff" in ACTIONS[a]);
    for (const a of staffActions) expect(can(staff(["super_admin"]), a)).toBe(true);
  });
  it("only the owner can grant privileged roles or change launch readiness", () => {
    for (const role of ["admin", "dsl", "editor", "support"] as StaffRole[]) {
      expect(can(staff([role]), "staff.grant_privileged")).toBe(false);
      expect(can(staff([role]), "launch_readiness.manage")).toBe(false);
    }
    expect(can(staff(["super_admin"]), "staff.grant_privileged")).toBe(true);
  });
  it("admin cannot read safeguarding notes; the DSL can", () => {
    expect(can(staff(["admin"]), "safeguarding.case.read_notes")).toBe(false);
    expect(can(staff(["dsl"]), "safeguarding.case.read_notes")).toBe(true);
  });
  it("an editor cannot approve or publish; a reviewer can", () => {
    expect(can(staff(["editor"]), "course.publish")).toBe(false);
    expect(can(staff(["editor"]), "course.review")).toBe(false);
    expect(can(staff(["reviewer"]), "course.publish")).toBe(true);
  });
  it("editors, moderators and the DSL can all take a course down quickly", () => {
    for (const role of ["editor", "moderator", "dsl", "reviewer"] as StaffRole[]) {
      expect(can(staff([role]), "course.take_down")).toBe(true);
    }
    expect(can(staff(["support"]), "course.take_down")).toBe(false);
  });
  it("staff are not treated as learners or parents", () => {
    expect(can(staff(["super_admin"]), "learner.coach.chat", ownA)).toBe(false);
    expect(can(staff(["super_admin"]), "family.consent.update", ownA)).toBe(false);
  });
});

describe("authz: system actor", () => {
  it("cannot perform actions that must carry a human's name", () => {
    for (const a of ["course.publish", "course.review", "tool.approve", "moderation.decide", "safeguarding.case.read_notes", "staff.grant_privileged"] as Action[]) {
      expect(can(system, a)).toBe(false);
    }
  });
  it("can run routine jobs", () => {
    expect(can(system, "course.take_down")).toBe(true);
    expect(can(system, "radar.manage")).toBe(true);
  });
});
