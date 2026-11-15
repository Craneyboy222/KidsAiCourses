import { randomUUID } from "node:crypto";
import { LEARNER_EMAIL_DOMAIN } from "../db/schema/identity";

/**
 * Learners have no email address (spec 3.1), but Better Auth 1.7 requires `user.email` to be a
 * unique, non-null string. So every learner row holds an internal placeholder of the form
 * `<random uuid>@learner.invalid`.
 *
 * - `.invalid` is reserved by RFC 2606: it can never resolve, so nothing can ever be delivered.
 * - The uuid is random, not the user id, so the placeholder reveals nothing.
 * - It is never displayed, never returned by our services and never used to sign in:
 *   `auth.ts` rejects it on every email route and strips it from Better Auth's own responses,
 *   and `sendAuthEmail` refuses to send to it.
 *
 * Always read an email through `userEmail()`. See docs/OPEN_QUESTIONS.md ("Learner email placeholder").
 */

export { LEARNER_EMAIL_DOMAIN };

const SUFFIX = `@${LEARNER_EMAIL_DOMAIN}`;

export function newLearnerPlaceholderEmail(): string {
  return `${randomUUID()}${SUFFIX}`;
}

export function isLearnerPlaceholderEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(SUFFIX);
}

/** The user's real email address, or `null` for a learner who has none. */
export function userEmail(user: { email: string | null | undefined }): string | null {
  const email = user.email;
  if (!email || isLearnerPlaceholderEmail(email)) return null;
  return email;
}
