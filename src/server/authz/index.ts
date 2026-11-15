import { AppError } from "@/server/errors";
import { ACTIONS, type Action, type Rule } from "./actions";
import type { Actor } from "./actor";

export * from "./actor";
export { ACTIONS, type Action } from "./actions";

/** What an action is being performed on. Ownership is decided from these ids, never from request input alone. */
export type Resource = {
  /** The learner who owns the record. */
  learnerId?: string | null;
  /** The family that owns the record. */
  familyId?: string | null;
};

const ACTIVE = new Set(["active"]);

/**
 * The single authorisation decision for the whole product.
 * Deny by default: an unknown action, a missing owner id or a mismatch all return false.
 */
export function can(actor: Actor, action: Action, resource: Resource = {}): boolean {
  const rule: Rule | undefined = ACTIONS[action];
  if (!rule) return false;

  switch (actor.type) {
    case "anonymous":
      return rule.anonymous === true;

    case "system":
      return rule.humanOnly !== true;

    case "learner": {
      if (rule.learner !== "self") return false;
      if (!rule.whilePaused && !ACTIVE.has(actor.status)) return false;
      // A learner may only ever act on their own records.
      return resource.learnerId === actor.userId;
    }

    case "parent": {
      if (rule.parent !== "family") return false;
      if (!rule.whilePaused && !ACTIVE.has(actor.status)) return false;
      return typeof resource.familyId === "string" && resource.familyId === actor.familyId;
    }

    case "staff": {
      // Staff access always needs a second factor (spec 3.1).
      if (!actor.twoFactorVerified) return false;
      if (!rule.staff) return false;
      if (actor.roles.includes("super_admin")) return true;
      return rule.staff.some((role) => actor.roles.includes(role));
    }
  }
}

export function assertCan(actor: Actor, action: Action, resource: Resource = {}): void {
  if (can(actor, action, resource)) return;
  if (actor.type === "anonymous") {
    throw new AppError("unauthenticated", "Please sign in to carry on.", { detail: { action } });
  }
  if (actor.type === "staff" && !actor.twoFactorVerified) {
    throw new AppError("two_factor_required", "Enter your two-factor code to open the staff area.", { detail: { action } });
  }
  if ((actor.type === "learner" || actor.type === "parent") && actor.status !== "active") {
    throw new AppError("paused", "This account is paused at the moment, so that isn't available. A parent or carer can sort it out from their dashboard.", {
      detail: { action, status: actor.status },
    });
  }
  throw new AppError("forbidden", "You don't have permission to do that.", { detail: { action } });
}

/** True for any staff member with a verified second factor. */
export function isStaff(actor: Actor): boolean {
  return actor.type === "staff" && actor.twoFactorVerified;
}

export function hasRole(actor: Actor, ...roles: Array<import("./actor").StaffRole>): boolean {
  return actor.type === "staff" && actor.twoFactorVerified && (actor.roles.includes("super_admin") || roles.some((r) => actor.roles.includes(r)));
}
