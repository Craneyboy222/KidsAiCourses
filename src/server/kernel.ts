import { wireAuthEmails } from "@/server/email";
import { wireAccountLockedNotifications } from "@/server/notifications";

/**
 * Connects the kernel services to the hooks other modules left for them:
 * - Better Auth's emails go through the email system (`setAuthEmailSender`).
 * - A sign-in lockout notifies the learner's parents (`setAccountLockedHandler`).
 *
 * Called once per server start from `src/instrumentation.ts`. Scripts and tests that need the
 * hooks call it themselves. Calling it more than once is harmless.
 */
export function installKernelHooks(): void {
  wireAuthEmails();
  wireAccountLockedNotifications();
}
