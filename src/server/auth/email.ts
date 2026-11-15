import { env } from "@/env";
import { isLearnerPlaceholderEmail } from "./learner-email";

/**
 * The seam between authentication and the email system.
 *
 * Better Auth calls `sendAuthEmail` whenever it needs to email someone. The real email system
 * (templates in `email_template`, a UK/EU provider) is being built separately; when it is ready it
 * calls `setAuthEmailSender(...)` once at start-up and this stub steps aside. Nothing in
 * `auth.ts` needs to change.
 *
 * Only parents and staff ever receive these: learners have no email address.
 */
export type AuthEmail =
  /** Confirm a parent's or staff member's address after sign-up. */
  | { kind: "verify_email"; to: string; url: string; userId: string }
  /** A parent or staff member asked to reset their own password. */
  | { kind: "reset_password"; to: string; url: string; userId: string }
  /** One-time sign-in link for a parent. Valid for ten minutes, single use. */
  | { kind: "magic_link"; to: string; url: string };

export type AuthEmailSender = (email: AuthEmail) => Promise<void>;

/** Default sender: prints the link locally so sign-up can be completed without an email account. */
const consoleSender: AuthEmailSender = async (email) => {
  if (env.APP_ENV === "production") {
    // Never print sign-in links in production logs. Fail loudly so the missing wiring is noticed.
    throw new Error(`No email sender is configured, so the "${email.kind}" email could not be sent.`);
  }
  console.info(`[auth email: ${email.kind}] to ${email.to}\n  ${email.url}`);
};

const globalForEmail = globalThis as typeof globalThis & { __platformAuthEmailSender?: AuthEmailSender };

/** Called once by the email system to take over delivery. */
export function setAuthEmailSender(sender: AuthEmailSender): void {
  globalForEmail.__platformAuthEmailSender = sender;
}

/** Test helper: go back to the console stub. */
export function resetAuthEmailSender(): void {
  globalForEmail.__platformAuthEmailSender = undefined;
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  // A learner's placeholder address must never reach a mail provider.
  if (isLearnerPlaceholderEmail(email.to)) return;
  const sender = globalForEmail.__platformAuthEmailSender ?? consoleSender;
  await sender(email);
}
