import { SubmitButton } from "@/components/ui";
import { signOutAction } from "../signin/actions";

/** A plain form, so signing out works without JavaScript. */
export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  return (
    <form action={signOutAction}>
      <SubmitButton variant="ghost" pendingText="Signing out…">
        {label}
      </SubmitButton>
    </form>
  );
}
