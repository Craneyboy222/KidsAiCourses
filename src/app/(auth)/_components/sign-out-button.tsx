"use client";

import { SubmitButton } from "@/components/ui";
import { clearServiceWorkerCaches } from "@/lib/marketing/service-worker-client";
import { signOutAction } from "../signin/actions";

/**
 * A plain form, so signing out works without JavaScript. As it is submitted, the service worker
 * is told to throw away what it has stored on this device (only build files and the offline
 * page, but a shared Chromebook should keep nothing from the last person).
 */
export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  return (
    <form action={signOutAction} onSubmit={clearServiceWorkerCaches}>
      <SubmitButton variant="ghost" pendingText="Signing out…">
        {label}
      </SubmitButton>
    </form>
  );
}
