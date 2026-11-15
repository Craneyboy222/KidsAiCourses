/**
 * The authorisation subject, resolved once per request (see docs/ARCHITECTURE.md).
 * These unions are the single definition; database enums must use the same values.
 */
export const SAFETY_BANDS = ["teen_13_15", "teen_16_17", "adult_18"] as const;
export type SafetyBand = (typeof SAFETY_BANDS)[number];

export const PATHWAYS = ["ks3", "ks4", "sixth_form"] as const;
export type Pathway = (typeof PATHWAYS)[number];

export const USER_KINDS = ["learner", "parent", "staff"] as const;
export type UserKind = (typeof USER_KINDS)[number];

export const USER_STATUSES = [
  "pending_parent", // teen-first sign-up waiting for a parent; deleted after 7 days
  "active",
  "paused", // parent pause, or a required consent was revoked
  "locked", // staff or parent lock, or too many failed sign-ins
  "banned",
  "pending_deletion", // inside the 14-day undo window
  "deleted",
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Spec 3.1. Teacher and school roles are deliberately absent; the list is extensible. */
export const STAFF_ROLES = [
  "editor",
  "reviewer",
  "safety_reviewer",
  "moderator",
  "dsl",
  "support",
  "admin",
  "super_admin",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type AnonymousActor = { type: "anonymous" };
export type SystemActor = { type: "system"; job: string };
export type LearnerActor = {
  type: "learner";
  userId: string;
  familyId: string | null;
  safetyBand: SafetyBand;
  /** Whole years, from birth month and year. */
  age: number;
  status: UserStatus;
};
export type ParentActor = { type: "parent"; userId: string; familyId: string; status: UserStatus };
export type StaffActor = { type: "staff"; userId: string; roles: StaffRole[]; twoFactorVerified: boolean };

export type Actor = AnonymousActor | SystemActor | LearnerActor | ParentActor | StaffActor;

export const ANONYMOUS: AnonymousActor = { type: "anonymous" };
export const systemActor = (job: string): SystemActor => ({ type: "system", job });

export function actorUserId(actor: Actor): string | null {
  return actor.type === "learner" || actor.type === "parent" || actor.type === "staff" ? actor.userId : null;
}
