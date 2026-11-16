import Link from "next/link";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/layout";
import { AuthFinePrint } from "../_components/fine-print";

/** The frame shared by `/join` and `/join/[inviteCode]`. */
export function JoinShell({ children }: { children: ReactNode }) {
  return (
    <AuthShell
      title="Use your code"
      description="Your parent or carer set up your account and gave you a one-time code. Use it here to choose your own password."
      footer={
        <p>
          Already chosen a password?{" "}
          <Link href="/signin?as=learner" className="link">
            Sign in
          </Link>
        </p>
      }
      finePrint={<AuthFinePrint />}
    >
      {children}
      <p className="text-ink-muted text-sm">
        Codes work once and last 72 hours. If yours has run out, ask your parent or carer to make a new one from their dashboard. You don&apos;t need an email address.
      </p>
    </AuthShell>
  );
}
