import { setAuthEmailSender, type AuthEmail } from "@/server/auth/email";
import { db } from "@/server/db";
import { sendEmail } from "./send";

export * from "./render";
export * from "./send";
export * from "./templates";
export * from "./transport";

const AUTH_TEMPLATES: Record<AuthEmail["kind"], string> = {
  verify_email: "verify_email",
  reset_password: "password_reset",
  magic_link: "magic_link",
};

/**
 * Makes Better Auth's emails (confirm address, reset password, sign-in link) go through this
 * system: same templates, same transport, same hard rules. Called once at start-up by
 * `installKernelHooks()`; calling it again is harmless.
 */
export function wireAuthEmails(): void {
  setAuthEmailSender(async (email) => {
    await sendEmail(
      { db, now: new Date() },
      {
        to: email.to,
        template: AUTH_TEMPLATES[email.kind],
        data: { url: email.url },
        ...("userId" in email ? { userId: email.userId } : {}),
      },
    );
  });
}
