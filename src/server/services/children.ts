import { and, eq, inArray } from "drizzle-orm";
import { env } from "@/env";
import { formatDateTime } from "@/lib/dates";
import { revokeAllSessions, setAccountPassword } from "@/server/auth/accounts";
import { assertPasswordAllowed } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { actorUserId, assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { account, dataRequest, family, user } from "@/server/db";
import { sendEmail } from "@/server/email";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { CONSENT_HOLD } from "./consent";
import { getEntitlementForFamily } from "./entitlements";
import { countSeatsUsed, getLearnerSummary, isIndependentLearner, type LearnerSummary } from "./family";
import { createInviteCode, revokeInviteCodes, type IssuedInvite } from "./invite";
import { assertOldEnough, assertSignupOpen, assertUsernameAllowed, insertLearner, type Birth } from "./signup";
import { checkNickname } from "./username";

/**
 * A parent's children: adding a profile, removing one, and resetting a child's password
 * (spec 3.1, Section 4 "Parent-first sign-up").
 *
 * A child profile is a nickname, a birth month and year and a username. There is no child email
 * address, real name, photo, school or location anywhere in this file, and there must never be.
 */

export type AddChildInput = Birth & {
  nickname: string;
  username: string;
  /** Leave out to get a one-time invite code for the child instead. */
  password?: string | null;
};

export type AddChildResult = {
  learnerId: string;
  nickname: string;
  username: string;
  /** Present when no password was set. Shown to the parent once. */
  invite: IssuedInvite | null;
};

/** How long a removal can be undone (spec 3.6: "request deletion, with a 14-day undo"). */
export const DELETION_UNDO_DAYS = 14;

/**
 * Whether the family has a free seat. The limit comes from the plan (`getEntitlementForFamily`,
 * payments slice). Throws a parent-facing message when the family is full.
 */
export async function assertSeatAvailable(ctx: Ctx, familyId: string, db = ctx.db): Promise<void> {
  const [entitlement, used] = await Promise.all([getEntitlementForFamily(ctx, familyId), countSeatsUsed(ctx, familyId, db)]);
  if (used >= entitlement.seats) {
    throw new AppError(
      "entitlement_required",
      `Your plan has room for ${entitlement.seats} ${entitlement.seats === 1 ? "learner" : "learners"}, and all of those places are in use. You can add places from your Billing page, or remove a child you no longer need.`,
      { status: 409, detail: { seats: entitlement.seats, used } },
    );
  }
}

/** Emails the parent the code they have just been shown, so it is not lost. Never fails the request. */
async function emailInviteCode(ctx: Ctx, parentUserId: string, childName: string, invite: IssuedInvite): Promise<void> {
  try {
    const rows = await ctx.db.select({ email: user.email }).from(user).where(and(eq(user.id, parentUserId), eq(user.kind, "parent"))).limit(1);
    const to = rows[0]?.email;
    if (!to) return;
    await sendEmail(ctx, {
      to,
      userId: parentUserId,
      template: "invite_code",
      data: {
        childName,
        code: invite.formatted,
        url: `${env.NEXT_PUBLIC_APP_URL}/join`,
        expiresOn: formatDateTime(invite.expiresAt),
      },
    });
  } catch (error) {
    logWarn("children.invite_email_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Adds a child to the signed-in parent's family.
 *
 * Order matters. The age gate runs first, so for an under-13 nothing else is read and nothing is
 * written. The new account is held (`paused`, reason `consent_required`) until the parent has
 * completed the consent centre for this child.
 */
export async function addChild(ctx: Ctx, input: AddChildInput): Promise<AddChildResult> {
  if (ctx.actor.type !== "parent") throw new AppError("forbidden", "Only a parent or carer can add a child.");
  const parent = ctx.actor;
  assertCan(parent, "family.child.add", { familyId: parent.familyId });
  await assertSignupOpen(ctx);
  const birth = { birthYear: input.birthYear, birthMonth: input.birthMonth };
  const age = await assertOldEnough(ctx, birth);

  const nickname = checkNickname(input.nickname);
  if (!nickname.ok) throw new AppError("invalid_input", nickname.message, { fieldErrors: { nickname: [nickname.message] } });
  const username = await assertUsernameAllowed(ctx.db, input.username, { nickname: nickname.nickname, birthYear: input.birthYear });
  if (input.password) await assertPasswordAllowed(input.password, { username, name: nickname.nickname });
  await assertSeatAvailable(ctx, parent.familyId);

  const result = await ctx.db.transaction(async (tx) => {
    // Lock the family row so two requests at once cannot both take the last seat.
    await tx.select({ id: family.id }).from(family).where(eq(family.id, parent.familyId)).for("update");
    await assertSeatAvailable(ctx, parent.familyId, tx);
    const learner = await insertLearner(ctx, tx, {
      nickname: nickname.nickname,
      username,
      birth,
      age,
      password: input.password ?? null,
      status: "paused",
      statusReason: CONSENT_HOLD.required,
      familyId: parent.familyId,
      addedBy: parent.userId,
    });
    const invite = input.password
      ? null
      : await createInviteCode(ctx, { learnerId: learner.id, familyId: parent.familyId, createdBy: parent.userId }, tx);
    await audit(
      ctx,
      { action: "family.child.add", targetType: "user", targetId: learner.id, meta: { familyId: parent.familyId, safetyBand: age.safetyBand, withInvite: invite !== null } },
      tx,
    );
    return { learnerId: learner.id, invite };
  });

  if (result.invite) await emailInviteCode(ctx, parent.userId, nickname.nickname, result.invite);
  return { learnerId: result.learnerId, nickname: nickname.nickname, username, invite: result.invite };
}

/** Loads a child and checks that the actor may manage them and that they still take instructions from a parent. */
async function manageableChild(ctx: Ctx, learnerId: string, action: "family.child.remove" | "family.child.reset_password" | "family.child.invite"): Promise<LearnerSummary & { familyId: string }> {
  const learner = await getLearnerSummary(ctx, learnerId);
  assertCan(ctx.actor, action, { learnerId, familyId: learner.familyId });
  if (!learner.familyId) throw new AppError("not_found", "That learner could not be found in your family.");
  if (await isIndependentLearner(ctx, learnerId)) {
    throw new AppError("forbidden", `${learner.nickname} is 18 and runs their own account now, so this is theirs to do.`);
  }
  if (learner.status === "pending_deletion") {
    throw new AppError("conflict", `${learner.nickname}'s account is already set to be deleted. You can undo that from your Privacy page.`);
  }
  return { ...learner, familyId: learner.familyId };
}

export type ResetChildPasswordResult = { learnerId: string; invite: IssuedInvite | null };

/**
 * A parent resets a child's password (spec 3.1). Either sets the new password given, or (with
 * none) removes the old password and issues a one-time code so the child chooses their own.
 * Either way the child is signed out everywhere and any earlier code stops working.
 */
export async function resetChildPassword(ctx: Ctx, learnerId: string, input: { password?: string | null } = {}): Promise<ResetChildPasswordResult> {
  const learner = await manageableChild(ctx, learnerId, "family.child.reset_password");
  if (input.password) await assertPasswordAllowed(input.password, { username: learner.username, name: learner.nickname });

  const invite = await ctx.db.transaction(async (tx) => {
    let issued: IssuedInvite | null = null;
    if (input.password) {
      await revokeInviteCodes(ctx, learnerId, tx);
      // Also ends every session and clears any sign-in lock.
      await setAccountPassword(tx, learnerId, input.password);
    } else {
      // The old password must stop working now, not when the code is used.
      await tx.delete(account).where(and(eq(account.userId, learnerId), eq(account.providerId, "credential")));
      await revokeAllSessions(tx, learnerId);
      issued = await createInviteCode(ctx, { learnerId, familyId: learner.familyId, createdBy: actorUserId(ctx.actor) }, tx);
    }
    await audit(ctx, { action: "family.child.reset_password", targetType: "user", targetId: learnerId, meta: { withInvite: issued !== null } }, tx);
    return issued;
  });

  if (invite && ctx.actor.type === "parent") await emailInviteCode(ctx, ctx.actor.userId, learner.nickname, invite);
  return { learnerId, invite };
}

/** A fresh invite code for a child who has not set a password yet. Their existing password, if any, keeps working. */
export async function issueChildInvite(ctx: Ctx, learnerId: string): Promise<IssuedInvite> {
  const learner = await manageableChild(ctx, learnerId, "family.child.invite");
  const invite = await ctx.db.transaction(async (tx) => {
    const issued = await createInviteCode(ctx, { learnerId, familyId: learner.familyId, createdBy: actorUserId(ctx.actor) }, tx);
    await audit(ctx, { action: "family.child.invite", targetType: "user", targetId: learnerId }, tx);
    return issued;
  });
  if (ctx.actor.type === "parent") await emailInviteCode(ctx, ctx.actor.userId, learner.nickname, invite);
  return invite;
}

export type RemoveChildResult = { learnerId: string; undoUntil: Date };

/**
 * Removes a child from the family by starting a deletion: the account becomes `pending_deletion`,
 * the child is signed out, and a `data_request` (kind `delete`) is left for the data-request flow
 * owned by the privacy slice, which does the deleting once the 14-day undo has passed and offers
 * the undo. Nothing is deleted here, and consent records are untouched (they are append-only
 * evidence). If an open deletion request already exists, it is reused.
 */
export async function removeChild(ctx: Ctx, learnerId: string): Promise<RemoveChildResult> {
  const learner = await manageableChild(ctx, learnerId, "family.child.remove");
  const undoUntil = new Date(ctx.now.getTime() + DELETION_UNDO_DAYS * 24 * 60 * 60 * 1000);

  return ctx.db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ status: "pending_deletion", statusReason: "removed_by_parent", updatedAt: ctx.now })
      .where(eq(user.id, learnerId));
    await revokeAllSessions(tx, learnerId);
    await revokeInviteCodes(ctx, learnerId, tx);

    const open = await tx
      .select({ id: dataRequest.id, undoUntil: dataRequest.undoUntil })
      .from(dataRequest)
      .where(and(eq(dataRequest.learnerId, learnerId), eq(dataRequest.kind, "delete"), inArray(dataRequest.status, ["requested", "processing"])))
      .limit(1);
    let until = open[0]?.undoUntil ?? undoUntil;
    if (!open[0]) {
      await tx.insert(dataRequest).values({
        kind: "delete",
        status: "requested",
        familyId: learner.familyId,
        learnerId,
        requestedBy: actorUserId(ctx.actor),
        undoUntil,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      until = undoUntil;
    }
    await audit(
      ctx,
      { action: "family.child.remove", targetType: "user", targetId: learnerId, reason: "Removed by a parent or carer", meta: { familyId: learner.familyId, undoUntil: until.toISOString() } },
      tx,
    );
    return { learnerId, undoUntil: until };
  });
}
