import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout";
import { Callout } from "@/components/ui";
import { getCtx } from "@/server/context";
import { tMany } from "@/server/copy";
import { AuthFinePrint } from "../_components/fine-print";
import { NewPasswordForm, ResetRequestForm } from "./reset-forms";

export const metadata: Metadata = { title: "Reset your password" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Password reset by email, for parents, carers and adult learners (and the team). A teenager's
 * password is reset by their parent, and the page says so: it never asks a child for an email address.
 */
export default async function ResetPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const token = one(params.token);
  const linkFailed = one(params.error) !== "";
  const copy = await tMany(await getCtx(), ["signin.learner.forgot_password"]);
  const footer = (
    <p>
      <Link href="/signin" className="link">
        Back to sign in
      </Link>
    </p>
  );

  if (token && !linkFailed) {
    return (
      <AuthShell title="Choose a new password" description="Once you save it, you'll be signed out everywhere and can sign in with the new one." footer={footer} finePrint={<AuthFinePrint />}>
        <NewPasswordForm token={token.slice(0, 200)} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="For parents, carers and anyone 18 or over with their own email address on their account. Enter your email address and we'll send you a link."
      footer={footer}
      finePrint={<AuthFinePrint />}
    >
      {linkFailed && (
        <Callout tone="warning" title="That link has run out">
          <p>Reset links work once and last an hour. Ask for a new one below.</p>
        </Callout>
      )}
      <ResetRequestForm />
      <Callout tone="info" title="A learner under 18?">
        <p>{copy["signin.learner.forgot_password"]}</p>
        <p>You don&apos;t have an email address on your account, so there&apos;s nothing to type here.</p>
      </Callout>
    </AuthShell>
  );
}
