import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout";
import { londonYearMonth } from "@/lib/dates";
import { tMany } from "@/server/copy";
import { listConsentDefinitions } from "@/server/services/consent";
import { checkSignupOpen } from "@/server/services/signup";
import { AuthFinePrint } from "../../_components/fine-print";
import { SignupClosed } from "../../_components/signup-closed";
import { redirectIfSignedIn } from "../../_lib/after-sign-in";
import { redirectIfAgeGated } from "../../_lib/age-gate";
import { TeenSignupForm } from "./teen-signup-form";

export const metadata: Metadata = { title: "Sign up" };

export default async function TeenSignupPage() {
  await redirectIfAgeGated();
  const ctx = await redirectIfSignedIn();
  if (!(await checkSignupOpen(ctx))) return <SignupClosed ctx={ctx} />;

  const copy = await tMany(ctx, ["signup.learner_no_email", "signup.teen.deleted_after_7_days", "signup.teen.locked_until_approved"]);
  const consents = (await listConsentDefinitions(ctx)).map(({ key, title, body, required }) => ({ key, title, body, required }));
  const { year } = londonYearMonth(ctx.now);

  return (
    <AuthShell
      title="Sign up"
      description="Make real things with today's AI tools. It takes about two minutes to get started."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/signin" className="link">
            Sign in
          </Link>
          {" · "}
          <Link href="/join" className="link">
            I have a code from my parent
          </Link>
        </p>
      }
      finePrint={<AuthFinePrint />}
    >
      <TeenSignupForm
        // A wide range on purpose: the form must not hint at which answers are let through.
        maxYear={year}
        minYear={year - 30}
        consents={consents}
        copy={{
          noEmail: copy["signup.learner_no_email"],
          deletedAfter7Days: copy["signup.teen.deleted_after_7_days"],
          lockedUntilApproved: copy["signup.teen.locked_until_approved"],
        }}
      />
      <p className="text-ink-muted text-sm">
        A parent or carer?{" "}
        <Link href="/signup/parent" className="link">
          Create a family account
        </Link>{" "}
        and add your child yourself.
      </p>
    </AuthShell>
  );
}
