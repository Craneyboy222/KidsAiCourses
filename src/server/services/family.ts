// CONTRACT — owner: accounts slice. See _contract.ts.
import { and, asc, count, eq, ne } from "drizzle-orm";
import { isLearnerPlaceholderEmail } from "@/server/auth/learner-email";
import type { Pathway, SafetyBand, UserStatus } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { family, familyMember, learnerProfile, user, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { ageFromBirth, safetyBandForAge, stricterBand } from "./age";

/**
 * Families and the learners in them.
 *
 * Nothing in this file returns or logs an email address. A learner's `user.email` is an internal
 * placeholder (see `auth/learner-email.ts`), so it is never selected here except to work out the
 * yes/no answer "does this adult learner have their own address?".
 */

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

type ReadCtx = Pick<Ctx, "db" | "now">;

const summaryColumns = {
  learnerId: user.id,
  familyId: familyMember.familyId,
  nickname: learnerProfile.nickname,
  username: user.username,
  status: user.status,
  birthYear: learnerProfile.birthYear,
  birthMonth: learnerProfile.birthMonth,
  storedBand: learnerProfile.safetyBand,
  pathway: learnerProfile.pathway,
  avatarSeed: learnerProfile.avatarSeed,
  interests: learnerProfile.interests,
  onboardingCompletedAt: learnerProfile.onboardingCompletedAt,
  a11y: learnerProfile.a11y,
};

type SummaryRow = {
  learnerId: string;
  familyId: string | null;
  nickname: string;
  username: string | null;
  status: UserStatus;
  birthYear: number;
  birthMonth: number;
  storedBand: SafetyBand;
  pathway: Pathway;
  avatarSeed: string;
  interests: string[];
  onboardingCompletedAt: Date | null;
  a11y: Record<string, unknown>;
};

function toSummary(row: SummaryRow, now: Date): LearnerSummary {
  const age = ageFromBirth(row.birthYear, row.birthMonth, now);
  const live = safetyBandForAge(age);
  return {
    learnerId: row.learnerId,
    familyId: row.familyId,
    nickname: row.nickname,
    username: row.username ?? "",
    age,
    // The stored band is refreshed by a daily job; until it catches up, the stricter one applies.
    safetyBand: live ? stricterBand(live, row.storedBand) : row.storedBand,
    pathway: row.pathway,
    status: row.status,
    avatarSeed: row.avatarSeed,
    interests: row.interests,
    onboardingCompleted: row.onboardingCompletedAt !== null,
    a11y: row.a11y,
  };
}

/** Callers must have checked authz (`learner.profile.read`) for this learner. */
export async function getLearnerSummary(ctx: ReadCtx, learnerId: string): Promise<LearnerSummary> {
  const rows = await ctx.db
    .select(summaryColumns)
    .from(user)
    .innerJoin(learnerProfile, eq(learnerProfile.userId, user.id))
    .leftJoin(familyMember, eq(familyMember.userId, user.id))
    .where(and(eq(user.id, learnerId), eq(user.kind, "learner"), ne(user.status, "deleted")))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError("not_found", "That learner could not be found. They may have been removed.");
  return toSummary(row, ctx.now);
}

/** Every learner in a family, oldest account first. Deleted accounts are left out. */
export async function listChildren(ctx: ReadCtx, familyId: string): Promise<LearnerSummary[]> {
  const rows = await ctx.db
    .select(summaryColumns)
    .from(familyMember)
    .innerJoin(user, eq(user.id, familyMember.userId))
    .innerJoin(learnerProfile, eq(learnerProfile.userId, user.id))
    .where(
      and(
        eq(familyMember.familyId, familyId),
        eq(familyMember.role, "learner"),
        eq(user.kind, "learner"),
        ne(user.status, "deleted"),
      ),
    )
    .orderBy(asc(familyMember.createdAt), asc(user.id));
  return rows.map((row) => toSummary(row, ctx.now));
}

/** User ids of the parents and carers linked to a family. */
export async function listParentUserIds(ctx: Pick<Ctx, "db">, familyId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ userId: familyMember.userId })
    .from(familyMember)
    .innerJoin(user, eq(user.id, familyMember.userId))
    .where(
      and(
        eq(familyMember.familyId, familyId),
        eq(familyMember.role, "parent"),
        eq(user.kind, "parent"),
        ne(user.status, "deleted"),
      ),
    )
    .orderBy(asc(familyMember.createdAt));
  return rows.map((row) => row.userId);
}

export async function getFamilyIdForLearner(ctx: Pick<Ctx, "db">, learnerId: string): Promise<string | null> {
  const rows = await ctx.db
    .select({ familyId: familyMember.familyId })
    .from(familyMember)
    .where(and(eq(familyMember.userId, learnerId), eq(familyMember.role, "learner")))
    .limit(1);
  return rows[0]?.familyId ?? null;
}

// ── Extras used by the accounts slice ───────────────────────────────────────

export type FamilyInfo = {
  id: string;
  ownerUserId: string;
  plan: string;
  ageAssuranceLevel: "none" | "parent_email" | "card_authorisation" | "paid_subscription";
  /** True when the owner has proved their email address. Never the address itself. */
  ownerEmailVerified: boolean;
  /** `parent` for a family run by a parent or carer; `learner` for an 18-year-old's own account. */
  ownerKind: string;
};

export async function getFamily(ctx: Pick<Ctx, "db">, familyId: string): Promise<FamilyInfo | null> {
  const rows = await ctx.db
    .select({
      id: family.id,
      ownerUserId: family.ownerUserId,
      plan: family.plan,
      ageAssuranceLevel: family.ageAssuranceLevel,
      ownerEmailVerified: user.emailVerified,
      ownerEmail: user.email,
      ownerKind: user.kind,
    })
    .from(family)
    .innerJoin(user, eq(user.id, family.ownerUserId))
    .where(eq(family.id, familyId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    plan: row.plan,
    ageAssuranceLevel: row.ageAssuranceLevel,
    // A placeholder address is "verified" in the database but proves nothing.
    ownerEmailVerified: row.ownerEmailVerified && !isLearnerPlaceholderEmail(row.ownerEmail),
    ownerKind: row.ownerKind,
  };
}

/**
 * How many of a family's seats are in use: every learner who has not been deleted. A child inside
 * the 14-day deletion undo window still holds their seat, because the deletion can be cancelled.
 */
export async function countSeatsUsed(ctx: Pick<Ctx, "db">, familyId: string, db: Db = ctx.db): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(familyMember)
    .innerJoin(user, eq(user.id, familyMember.userId))
    .where(and(eq(familyMember.familyId, familyId), eq(familyMember.role, "learner"), ne(user.status, "deleted")));
  return Number(rows[0]?.n ?? 0);
}

/**
 * True for an 18-year-old who runs their own account: an adult learner with their own, verified
 * email address. A parent can no longer reset their password, remove them or change their consents.
 */
export async function isIndependentLearner(ctx: ReadCtx, learnerId: string): Promise<boolean> {
  const rows = await ctx.db
    .select({
      email: user.email,
      emailVerified: user.emailVerified,
      birthYear: learnerProfile.birthYear,
      birthMonth: learnerProfile.birthMonth,
      storedBand: learnerProfile.safetyBand,
    })
    .from(user)
    .innerJoin(learnerProfile, eq(learnerProfile.userId, user.id))
    .where(and(eq(user.id, learnerId), eq(user.kind, "learner")))
    .limit(1);
  const row = rows[0];
  if (!row || isLearnerPlaceholderEmail(row.email) || !row.emailVerified) return false;
  const live = safetyBandForAge(ageFromBirth(row.birthYear, row.birthMonth, ctx.now));
  return live !== null && stricterBand(live, row.storedBand) === "adult_18";
}
