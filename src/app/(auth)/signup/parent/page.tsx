import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout";
import { checkSignupOpen } from "@/server/services/signup";
import { AuthFinePrint } from "../../_components/fine-print";
import { SignupClosed } from "../../_components/signup-closed";
import { redirectIfSignedIn } from "../../_lib/after-sign-in";
import { redirectIfAgeGated } from "../../_lib/age-gate";
import { ParentSignupForm } from "./parent-signup-form";

export const metadata: Metadata = { title: "Create a family account" };

export default async function ParentSignupPage() {
  await redirectIfAgeGated();
  const ctx = await redirectIfSignedIn();
  if (!(await checkSignupOpen(ctx))) return <SignupClosed ctx={ctx} />;

  return (
    <AuthShell
      title="Create a family account"
      description="For parents and carers. You create the family account, then add each child with a nickname and a username. Your child never needs an email address."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/signin?as=parent" className="link">
            Sign in
          </Link>
        </p>
      }
      finePrint={<AuthFinePrint />}
    >
      <ParentSignupForm />
      <p className="text-ink-muted text-sm">
        A teenager signing up for yourself?{" "}
        <Link href="/signup/teen" className="link">
          Start here instead
        </Link>
        .
      </p>
    </AuthShell>
  );
}
