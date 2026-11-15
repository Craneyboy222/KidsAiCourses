// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type CertificateView = { id: string; learnerId: string; courseTitle: string; displayName: string; issuedAt: Date; verifyCode: string; revokedAt: Date | null };

export async function listCertificates(_ctx: Ctx, _learnerId: string): Promise<CertificateView[]> {
  return notImplemented("certificate.listCertificates");
}
/** Issues a certificate once the course is complete AND the required submission is accepted. Never while it is pending or blocked. Idempotent. */
export async function issueCertificateIfEligible(_ctx: Ctx, _enrolmentId: string): Promise<CertificateView | null> {
  return notImplemented("certificate.issueCertificateIfEligible");
}
/** Public verification: first name or nickname, course, date, and whether it was revoked. Nothing else. */
export async function verifyCertificate(_ctx: Ctx, _code: string): Promise<{ displayName: string; courseTitle: string; issuedAt: Date; revoked: boolean } | null> {
  return notImplemented("certificate.verifyCertificate");
}
