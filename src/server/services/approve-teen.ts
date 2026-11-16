import { and, eq } from "drizzle-orm";
import { createAccount } from "@/server/auth/accounts";
import { assertPasswordAllowed } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { hashToken } from "@/server/crypto";
import { family, familyMember, parentLinkRequest, user } from "@/server/db";
import { AppError } from "@/server/errors";
import { assertSeatAvailable } from "./children";
import { CONSENT_HOLD } from "./consent";
import { DEFAULT_PARENT_NAME, assertSignupOpen } from "./signup";
import { erasePendingTeen } from "./teen-signup";

/**
 * A parent approves a teen-first sign-up (spec 3.1, `/approve/[token]`).
 *
 *   1. The emailed link is opened. Only a hash of the token is stored, and it works for 7 days.
 *   2. The parent signs in, or creates a parent account. An account created here uses the address
 *      the link was sent to, which the link itself has just proved, so it needs no second email.
 *   3. `approveTeen` links the teen to the parent's family, if the plan has a free seat.
 *   4. The teen is still not active: the account is held until the parent has completed the
 *      consent centre for them (`consent.ts`). Only then does it become `active`.
 *
 * A parent who does not recognise the request can decline, which deletes the pending account at once.
 */

export type ApprovalRequestView =
  | { state: "unknown" }
  | { state: "expired" }
  | { state: "approved"; learnerId: string }
  | {
      state: "pending";
      /** The username the teen chose. It has passed the personal-information checks. */
      username: string;
      expiresAt: Date;
      /** True when the address the link was sent to already has a parent account: sign in rather than create one. */
      parentAccountExists: boolean;
    };

type LoadedRequest = {
  id: string;
  learnerId: string;
  parentEmail: string;
  status: "pending" | "approved" | "declined" | "expired";
  expiresAt: Date;
  username: string | null;
  learnerStatus: string;
};

async function loadRequest(ctx: Pick<Ctx, "db">, token: string): Promise<LoadedRequest | null> {
  if (!token || token.length > 200) return null;
  const rows = await ctx.db
    .select({
      id: parentLinkRequest.id,
      learnerId: parentLinkRequest.learnerId,
      parentEmail: parentLinkRequest.parentEmail,
      status: parentLinkRequest.status,
      expiresAt: parentLinkRequest.expiresAt,
      username: user.username,
      learnerStatus: user.status,
    })
    .from(parentLinkRequest)
    .innerJoin(user, eq(user.id, parentLinkRequest.learnerId))
    .where(eq(parentLinkRequest.tokenHash, hashToken(token)))
    .limit(1);
  return rows[0] ?? null;
}

/** What the approval page should show for a token. Gives nothing away about a token it does not know. */
export async function getApprovalRequest(ctx: Pick<Ctx, "db" | "now">, token: string): Promise<ApprovalRequestView> {
  const request = await loadRequest(ctx, token);
  if (!request) return { state: "unknown" };
  if (request.status === "approved") return { state: "approved", learnerId: request.learnerId };
  if (request.status !== "pending" || request.learnerStatus !== "pending_parent") return { state: "unknown" };
  if (request.expiresAt <= ctx.now) return { state: "expired" };
  const existing = await ctx.db.select({ kind: user.kind }).from(user).where(eq(user.email, request.parentEmail.toLowerCase())).limit(1);
  return {
    state: "pending",
    username: request.username ?? "",
    expiresAt: request.expiresAt,
    parentAccountExists: existing.length > 0,
  };
}

async function requirePending(ctx: Pick<Ctx, "db" | "now">, token: string): Promise<LoadedRequest> {
  const request = await loadRequest(ctx, token);
  if (!request || request.status === "declined" || (request.status === "pending" && request.learnerStatus !== "pending_parent")) {
    throw new AppError("not_found", "That approval link isn't valid. It may have been replaced by a newer email, so check for the most recent one.");
  }
  if (request.status === "approved") throw new AppError("conflict", "This request has already been approved. Sign in to your parent account to carry on.");
  if (request.status === "expired" || request.expiresAt <= ctx.now) {
    throw new AppError("conflict", "This request has run out, and the account it was for has been deleted. Your child can sign up again, or you can create a family account and add them yourself.");
  }
  return request;
}

export type ApprovalParentInput = {
  password: string;
  name?: string | null;
  /** The 18+ and parental-responsibility declaration. Must be true. */
  confirmedAdult: boolean;
};

/**
 * Creates the parent account for the address the approval link was sent to, with its family.
 * Returns the address so the Server Action can sign the new parent in with the password they
 * have just chosen. Nothing is approved yet.
 */
export async function createParentForApproval(ctx: Ctx, token: string, input: ApprovalParentInput): Promise<{ userId: string; familyId: string; email: string }> {
  assertCan(ctx.actor, "signup.approve_teen");
  await assertSignupOpen(ctx);
  const request = await requirePending(ctx, token);
  if (!input.confirmedAdult) {
    throw new AppError("invalid_input", "Parent accounts are for adults. Please confirm that you are 18 or over and are the parent or carer.", {
      fieldErrors: { confirmedAdult: ["Tick this box to confirm."] },
    });
  }
  const email = request.parentEmail.toLowerCase();
  await assertPasswordAllowed(input.password, { name: input.name ?? null, email });
  try {
    return await ctx.db.transaction(async (tx) => {
      const parent = await createAccount(tx, {
        kind: "parent",
        name: input.name?.trim() || DEFAULT_PARENT_NAME,
        email,
        password: input.password,
        // They arrived by a link sent to this address, which proves it is theirs.
        emailVerified: true,
        status: "active",
      });
      const families = await tx.insert(family).values({ ownerUserId: parent.id, plan: "free", createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: family.id });
      const familyId = families[0]?.id;
      if (!familyId) throw new Error("Family insert returned no row");
      await tx.insert(familyMember).values({ familyId, userId: parent.id, role: "parent", createdAt: ctx.now, updatedAt: ctx.now });
      await audit(ctx, { action: "signup.parent", targetType: "user", targetId: parent.id, meta: { familyId, via: "teen_approval" } }, tx);
      return { userId: parent.id, familyId, email };
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "conflict") {
      throw new AppError("conflict", "There is already an account for this email address. Sign in to it, then open the link in the email again.");
    }
    throw error;
  }
}

/**
 * The signed-in parent takes the teen into their family. The teen's account moves from
 * `pending_parent` to held-for-consent; it becomes active when the consent centre is complete.
 */
export async function approveTeen(ctx: Ctx, token: string): Promise<{ learnerId: string; familyId: string }> {
  if (ctx.actor.type !== "parent") {
    throw new AppError("unauthenticated", "Sign in to your parent account, or create one, to approve this request.");
  }
  const parent = ctx.actor;
  assertCan(parent, "signup.approve_teen", { familyId: parent.familyId });
  const request = await requirePending(ctx, token);
  await assertSeatAvailable(ctx, parent.familyId);

  await ctx.db.transaction(async (tx) => {
    await tx.select({ id: family.id }).from(family).where(eq(family.id, parent.familyId)).for("update");
    await assertSeatAvailable(ctx, parent.familyId, tx);
    // Only one approval can win: the status check is part of the update.
    const claimed = await tx
      .update(parentLinkRequest)
      .set({ status: "approved", resolvedAt: ctx.now, resolvedBy: parent.userId, updatedAt: ctx.now })
      .where(and(eq(parentLinkRequest.id, request.id), eq(parentLinkRequest.status, "pending")))
      .returning({ id: parentLinkRequest.id });
    if (claimed.length === 0) throw new AppError("conflict", "This request has already been dealt with.");
    await tx.insert(familyMember).values({ familyId: parent.familyId, userId: request.learnerId, role: "learner", addedBy: parent.userId, createdAt: ctx.now, updatedAt: ctx.now });
    await tx
      .update(user)
      .set({ status: "paused", statusReason: CONSENT_HOLD.required, updatedAt: ctx.now })
      .where(and(eq(user.id, request.learnerId), eq(user.status, "pending_parent")));
    await audit(ctx, { action: "signup.approve_teen", targetType: "user", targetId: request.learnerId, meta: { familyId: parent.familyId } }, tx);
  });
  return { learnerId: request.learnerId, familyId: parent.familyId };
}

/**
 * "I don't recognise this" or "no": the pending account is deleted straight away, with everything
 * about it. Anyone holding the link may do this; it only brings forward what would happen after 7 days.
 */
export async function declineTeen(ctx: Ctx, token: string): Promise<void> {
  assertCan(ctx.actor, "signup.approve_teen", ctx.actor.type === "parent" ? { familyId: ctx.actor.familyId } : {});
  const request = await requirePending(ctx, token);
  await erasePendingTeen(ctx, request.learnerId);
}
