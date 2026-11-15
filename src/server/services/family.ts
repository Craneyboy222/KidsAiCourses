// CONTRACT — owner: accounts slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import type { Pathway, SafetyBand, UserStatus } from "@/server/authz";
import { notImplemented } from "./_contract";

export type LearnerSummary = {
  learnerId: string;
  familyId: string | null;
  nickname: string;
  username: string;
  age: number;
  safetyBand: SafetyBand;
  pathway: Pathway;
  status: UserStatus;
  avatarSeed: string;
  interests: string[];
  onboardingCompleted: boolean;
  a11y: Record<string, unknown>;
};

/** Callers must have checked authz (`learner.profile.read`) for this learner. */
export async function getLearnerSummary(_ctx: Ctx, _learnerId: string): Promise<LearnerSummary> {
  return notImplemented("family.getLearnerSummary");
}
export async function listChildren(_ctx: Ctx, _familyId: string): Promise<LearnerSummary[]> {
  return notImplemented("family.listChildren");
}
/** User ids of the parents and carers linked to a family. */
export async function listParentUserIds(_ctx: Ctx, _familyId: string): Promise<string[]> {
  return notImplemented("family.listParentUserIds");
}
export async function getFamilyIdForLearner(_ctx: Ctx, _learnerId: string): Promise<string | null> {
  return notImplemented("family.getFamilyIdForLearner");
}
