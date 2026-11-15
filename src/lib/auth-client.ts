"use client";

import {
  inferAdditionalFields,
  magicLinkClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { Auth } from "@/server/auth/auth";

/**
 * Browser client for Better Auth, with the same plugins as the server (`src/server/auth/auth.ts`).
 * The import of `Auth` above is type-only, so no server code reaches the browser.
 *
 * - Learners: `authClient.signIn.username({ username, password })`
 * - Parents and staff: `authClient.signIn.email({ email, password })`
 * - Parents: `authClient.signIn.magicLink({ email, callbackURL })`
 * - Staff second step: `authClient.twoFactor.verifyTotp({ code })`
 *
 * Accounts are created by Server Actions, never from here. A learner's `user.email` is always null.
 */
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<Auth>(),
    usernameClient({ displayUsername: false }),
    magicLinkClient(),
    // No automatic redirect: for staff, `signIn.email` resolves with `data.twoFactorRedirect === true`
    // and the sign-in form then shows the code step and calls `twoFactor.verifyTotp`.
    twoFactorClient(),
  ],
});

export const { signIn, signOut, useSession } = authClient;
