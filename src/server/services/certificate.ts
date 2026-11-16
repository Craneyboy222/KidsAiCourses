// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import { and, desc, eq, isNull } from "drizzle-orm";
import { env } from "@/env";
import { audit } from "@/server/audit";
import { assertCan, can } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { newCode } from "@/server/crypto";
import { certificate, learnerProfile, project, projectVersion } from "@/server/db";
import { AppError } from "@/server/errors";
import { logError } from "@/server/log";
import { notify } from "@/server/notifications";
import { getEnrolmentById } from "./enrolment";
import { getFamilyIdForLearner } from "./family";
import { checkNickname } from "./username";

export type CertificateView = { id: string; learnerId: string; courseTitle: string; displayName: string; issuedAt: Date; verifyCode: string; revokedAt: Date | null };

type CertificateRow = typeof certificate.$inferSelect;

const toView = (row: CertificateRow): CertificateView => ({ id: row.id, learnerId: row.learnerId, courseTitle: row.courseTitle, displayName: row.displayName, issuedAt: row.issuedAt, verifyCode: row.verifyCode, revokedAt: row.revokedAt });

const NOT_FOUND = "That certificate could not be found.";
const CODE_LENGTH = 16;

/** `ABCD-EFGH-JKMN-PQRS`: sixteen characters from an alphabet with no look-alikes. Random, so it says nothing about who or when. */
export function newVerifyCode(): string {
  return (newCode(CODE_LENGTH).match(/.{4}/g) ?? []).join("-");
}

/** What somebody typed or followed, in the stored form. Null when it could not be a code at all. */
export function normaliseVerifyCode(input: string): string | null {
  const plain = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (plain.length !== CODE_LENGTH) return null;
  return (plain.match(/.{4}/g) ?? []).join("-");
}

export const verifyUrlFor = (code: string): string => `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/verify/${code}`;

/** The learner, a parent or carer in their family, or staff who may read certificates. */
async function assertMayRead(ctx: Ctx, learnerId: string): Promise<void> {
  const familyId = ctx.actor.type === "parent" ? await getFamilyIdForLearner(ctx, learnerId) : null;
  assertCan(ctx.actor, "learner.certificate.read", { learnerId, familyId });
}

export async function listCertificates(ctx: Ctx, learnerId: string): Promise<CertificateView[]> {
  await assertMayRead(ctx, learnerId);
  const rows = await ctx.db.select().from(certificate).where(eq(certificate.learnerId, learnerId)).orderBy(desc(certificate.issuedAt));
  return rows.map(toView);
}

/**
 * Issues a certificate once the course is complete AND the required submission is accepted. Never while it is pending or blocked. Idempotent.
 *
 * Both halves are read fresh from the database every time: the enrolment must be `completed`, and
 * the project for it must be `accepted` with its current submission approved by the checks or by a
 * person. A held, sampled, escalated or rejected submission issues nothing. One certificate per
 * enrolment; a revoked one is never replaced. Returns null when not eligible, and also to anyone
 * who has no business asking about this enrolment.
 */
export async function issueCertificateIfEligible(ctx: Ctx, enrolmentId: string): Promise<CertificateView | null> {
  const view = await getEnrolmentById(ctx, enrolmentId);
  if (!view) return null;

  const [existing] = await ctx.db.select().from(certificate).where(eq(certificate.enrolmentId, enrolmentId)).limit(1);
  if (existing) return toView(existing);
  if (view.status !== "completed") return null;

  const [accepted] = await ctx.db
    .select({ projectId: project.id, status: project.status, versionState: projectVersion.moderationState })
    .from(project)
    .innerJoin(projectVersion, eq(projectVersion.id, project.currentVersionId))
    .where(eq(project.enrolmentId, enrolmentId))
    .limit(1);
  if (!accepted || accepted.status !== "accepted" || accepted.versionState !== "approved") return null;

  const [profile] = await ctx.db.select({ nickname: learnerProfile.nickname, firstName: learnerProfile.firstName, choice: learnerProfile.certificateNameChoice }).from(learnerProfile).where(eq(learnerProfile.userId, view.learnerId)).limit(1);
  if (!profile) return null;
  const firstName = profile.firstName?.trim() ?? "";
  const displayName = profile.choice === "first_name" && firstName.length > 0 ? firstName : profile.nickname;

  const [created] = await ctx.db
    .insert(certificate)
    .values({ learnerId: view.learnerId, enrolmentId, courseId: view.courseId, courseVersionId: view.courseVersionId, projectId: accepted.projectId, verifyCode: newVerifyCode(), displayName, courseTitle: view.courseTitle, issuedAt: ctx.now, createdAt: ctx.now, updatedAt: ctx.now })
    .onConflictDoNothing({ target: certificate.enrolmentId })
    .returning();
  if (!created) {
    // Two requests at once: the other one issued it.
    const [winner] = await ctx.db.select().from(certificate).where(eq(certificate.enrolmentId, enrolmentId)).limit(1);
    return winner ? toView(winner) : null;
  }

  try {
    await notify(ctx, { userId: view.learnerId, type: "certificate.issued", title: "You've earned a certificate", body: `Your certificate for "${view.courseTitle}" is ready to download.`, href: "/certificates", channels: ["in_app"], dedupeKey: `certificate:${created.id}` });
  } catch (error) {
    logError("certificate.notify_failed", error, { certificateId: created.id });
  }
  return toView(created);
}

/**
 * Catches up on certificates that are due but were never issued: a project accepted BEFORE the
 * learner finished the last step of the course has nothing to trigger it at the moment the course
 * completes. Safe to call on any page load: it only ever issues what `issueCertificateIfEligible`
 * would, and does nothing when there is nothing due.
 */
export async function issueOutstandingCertificates(ctx: Ctx, learnerId: string): Promise<CertificateView[]> {
  await assertMayRead(ctx, learnerId);
  const due = await ctx.db
    .select({ enrolmentId: project.enrolmentId })
    .from(project)
    .leftJoin(certificate, eq(certificate.enrolmentId, project.enrolmentId))
    .where(and(eq(project.learnerId, learnerId), eq(project.status, "accepted"), isNull(certificate.id)));
  const issued: CertificateView[] = [];
  for (const row of due) {
    const view = await issueCertificateIfEligible(ctx, row.enrolmentId);
    if (view) issued.push(view);
  }
  return issued;
}

/** Public verification: first name or nickname, course, date, and whether it was revoked. Nothing else. */
export async function verifyCertificate(ctx: Ctx, code: string): Promise<{ displayName: string; courseTitle: string; issuedAt: Date; revoked: boolean } | null> {
  assertCan(ctx.actor, "public.certificate.verify", ctx.actor.type === "learner" ? { learnerId: ctx.actor.userId } : ctx.actor.type === "parent" ? { familyId: ctx.actor.familyId } : {});
  const normalised = normaliseVerifyCode(code);
  if (!normalised) return null;
  const [row] = await ctx.db
    .select({ displayName: certificate.displayName, courseTitle: certificate.courseTitle, issuedAt: certificate.issuedAt, revokedAt: certificate.revokedAt })
    .from(certificate)
    .where(eq(certificate.verifyCode, normalised))
    .limit(1);
  if (!row) return null;
  return { displayName: row.displayName, courseTitle: row.courseTitle, issuedAt: row.issuedAt, revoked: row.revokedAt !== null };
}

/** Staff withdraw a certificate, with a reason. The verify page then says it was revoked; the PDF can no longer be downloaded. */
export async function revokeCertificate(ctx: Ctx, certificateId: string, reason: string): Promise<CertificateView> {
  assertCan(ctx.actor, "certificate.revoke");
  if (ctx.actor.type !== "staff") throw new AppError("forbidden", "You don't have permission to do that.");
  const why = reason.trim();
  if (why.length < 5) throw new AppError("invalid_input", "Give a reason for withdrawing this certificate.", { fieldErrors: { reason: ["Write a short reason. It is kept on record."] } });
  const staffId = ctx.actor.userId;
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(certificate).where(eq(certificate.id, certificateId)).for("update");
    if (!row) throw new AppError("not_found", NOT_FOUND);
    if (row.revokedAt !== null) return toView(row);
    const [updated] = await tx.update(certificate).set({ revokedAt: ctx.now, revokedReason: why.slice(0, 500), revokedBy: staffId, updatedAt: ctx.now }).where(eq(certificate.id, row.id)).returning();
    await audit(ctx, { action: "certificate.revoke", targetType: "certificate", targetId: row.id, reason: why.slice(0, 500), meta: { learnerId: row.learnerId, courseId: row.courseId } }, tx);
    return toView(updated ?? row);
  });
}

/** The PDF for one certificate, for the learner, their parents and authorised staff. Somebody else's answers like one that does not exist. */
export async function getCertificatePdf(ctx: Ctx, certificateId: string): Promise<{ fileName: string; bytes: Buffer }> {
  if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  const [row] = /^[0-9a-f-]{36}$/i.test(certificateId) ? await ctx.db.select().from(certificate).where(eq(certificate.id, certificateId)).limit(1) : [];
  if (!row) throw new AppError("not_found", NOT_FOUND);
  const familyId = ctx.actor.type === "parent" ? await getFamilyIdForLearner(ctx, row.learnerId) : null;
  if (!can(ctx.actor, "learner.certificate.read", { learnerId: row.learnerId, familyId })) {
    if (ctx.actor.type === "learner" && ctx.actor.userId === row.learnerId) assertCan(ctx.actor, "learner.certificate.read", { learnerId: row.learnerId });
    throw new AppError("not_found", NOT_FOUND);
  }
  if (row.revokedAt !== null) throw new AppError("conflict", "This certificate has been withdrawn, so it can't be downloaded. Get in touch with us if you think that's a mistake.");
  // Loaded only when a PDF is asked for: the renderer is large and nothing else needs it.
  const { renderCertificatePdf } = await import("./certificate-pdf");
  const bytes = await renderCertificatePdf({ displayName: row.displayName, courseTitle: row.courseTitle, issuedAt: row.issuedAt, verifyCode: row.verifyCode, verifyUrl: verifyUrlFor(row.verifyCode) });
  if (ctx.actor.type === "staff") await audit(ctx, { action: "certificate.download", targetType: "certificate", targetId: row.id, meta: { learnerId: row.learnerId } });
  return { fileName: "certificate.pdf", bytes };
}

export type CertificateNameSettings = { choice: "nickname" | "first_name"; nickname: string; firstName: string };

export async function getCertificateName(ctx: Ctx, learnerId: string): Promise<CertificateNameSettings> {
  await assertMayRead(ctx, learnerId);
  const [profile] = await ctx.db.select({ nickname: learnerProfile.nickname, firstName: learnerProfile.firstName, choice: learnerProfile.certificateNameChoice }).from(learnerProfile).where(eq(learnerProfile.userId, learnerId)).limit(1);
  if (!profile) throw new AppError("not_found", "That learner could not be found.");
  return { choice: profile.choice, nickname: profile.nickname, firstName: profile.firstName ?? "" };
}

/**
 * The learner chooses what future certificates say: their nickname (the default) or a first name.
 * One word only, never a full name: the name appears on the public verify page. Certificates
 * already issued keep the name they were issued with.
 */
export async function setCertificateName(ctx: Ctx, learnerId: string, input: { choice: "nickname" | "first_name"; firstName?: string }): Promise<CertificateNameSettings> {
  assertCan(ctx.actor, "learner.settings.update", { learnerId });
  if (input.choice === "nickname") {
    await ctx.db.update(learnerProfile).set({ certificateNameChoice: "nickname", updatedAt: ctx.now }).where(eq(learnerProfile.userId, learnerId));
    return getCertificateName(ctx, learnerId);
  }
  const checked = checkNickname(input.firstName ?? "");
  const problem = !checked.ok ? "Type your first name, or choose your nickname instead." : checked.nickname.includes(" ") ? "Use your first name only, without a surname." : !/^[\p{L}][\p{L}'’-]*$/u.test(checked.nickname) ? "A first name can only have letters in it." : null;
  if (problem || !checked.ok) throw new AppError("invalid_input", problem ?? "Type your first name.", { fieldErrors: { firstName: [problem ?? "Type your first name."] } });
  await ctx.db.update(learnerProfile).set({ certificateNameChoice: "first_name", firstName: checked.nickname, updatedAt: ctx.now }).where(eq(learnerProfile.userId, learnerId));
  return getCertificateName(ctx, learnerId);
}
