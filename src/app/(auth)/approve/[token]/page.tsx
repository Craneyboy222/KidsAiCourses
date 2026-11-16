import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout";
import { Callout, LinkButton } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getCtx } from "@/server/context";
import { tMany } from "@/server/copy";
import { SAFETY_HOW_IT_WORKS_KEYS } from "@/content/copy/en-GB";
import { getApprovalRequest } from "@/server/services/approve-teen";
import { AuthFinePrint } from "../../_components/fine-print";
import { SignOutButton } from "../../_components/sign-out-button";
import { ApproveForm, CreateParentForm, DeclineForm } from "./approve-forms";

export const metadata: Metadata = { title: "Approve an account" };

/**
 * Where the email to a parent leads (spec 3.1, `/approve/[token]`). The parent signs in or
 * creates a parent account, says yes or no, and after a yes completes the consent centre. Until
 * that is done the teen's account stays locked.
 */
export default async function ApprovePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token: rawToken } = await params;
  const declined = (await searchParams).declined === "1";
  const token = decodeURIComponent(rawToken).slice(0, 200);
  const ctx = await getCtx();
  const request = await getApprovalRequest(ctx, token);
  const finePrint = <AuthFinePrint />;

  if (request.state === "unknown" && declined) {
    return (
      <AuthShell title="Done: the account has been deleted" finePrint={finePrint}>
        <p>Nothing about it has been kept, and we won&apos;t email you about it again. You can close this page.</p>
      </AuthShell>
    );
  }

  if (request.state === "unknown") {
    return (
      <AuthShell title="This link isn't valid" finePrint={finePrint}>
        <p>It may have been replaced by a newer email, so check your inbox for the most recent one. If the request was declined or has run out, the account it was for has been deleted.</p>
        <p>
          You can also{" "}
          <Link href="/signup/parent" className="link">
            create a family account
          </Link>{" "}
          and add your child yourself.
        </p>
      </AuthShell>
    );
  }

  if (request.state === "expired") {
    return (
      <AuthShell title="This request has run out" finePrint={finePrint}>
        <p>Requests last 7 days. This one was not approved in time, so the account it was for is deleted, along with everything in it.</p>
        <p>
          Your child can sign up again, or you can{" "}
          <Link href="/signup/parent" className="link">
            create a family account
          </Link>{" "}
          and add them yourself.
        </p>
      </AuthShell>
    );
  }

  if (request.state === "approved") {
    return (
      <AuthShell title="Already approved" finePrint={finePrint}>
        <p>This request has been approved. If you haven&apos;t finished the permissions for the account yet, you can do that now.</p>
        <div>
          <LinkButton href={ctx.actor.type === "parent" ? `/parent/children/${request.learnerId}/consent` : `/signin?as=parent&next=${encodeURIComponent(`/parent/children/${request.learnerId}/consent`)}`}>
            {ctx.actor.type === "parent" ? "Go to the permissions" : "Sign in to carry on"}
          </LinkButton>
        </div>
      </AuthShell>
    );
  }

  const copy = await tMany(ctx, ["safety.how_it_works.title", ...SAFETY_HOW_IT_WORKS_KEYS]);
  const signInHref = `/signin?as=parent&next=${encodeURIComponent(`/approve/${encodeURIComponent(token)}`)}`;
  const intro = (
    <>
      <p>
        Someone has signed up with the username <strong>{request.username}</strong> and gave your email address as their parent or carer.
      </p>
      <Callout tone="info" title={`Please decide by ${formatDate(request.expiresAt)}`}>
        <p>Until you approve it, the account is locked. If nobody approves it by then, it is deleted with everything in it.</p>
      </Callout>
    </>
  );
  const howItWorks = (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-bold">{copy["safety.how_it_works.title"]}</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {SAFETY_HOW_IT_WORKS_KEYS.map((key) => (
          <li key={key}>{copy[key]}</li>
        ))}
      </ul>
    </section>
  );
  const decline = (
    <section className="border-line flex flex-col gap-3 border-t-2 pt-5">
      <h2 className="text-xl font-bold">Not your child, or you&apos;d rather not?</h2>
      <p className="text-ink-muted">Saying no deletes the account straight away. Nothing is kept, and we won&apos;t email you about it again.</p>
      <DeclineForm token={token} />
    </section>
  );

  if (ctx.actor.type === "parent") {
    return (
      <AuthShell title="Approve this account?" finePrint={finePrint}>
        {intro}
        {howItWorks}
        <ApproveForm token={token} username={request.username} />
        <p className="text-ink-muted text-sm">Next, we&apos;ll ask you for the permissions the account needs. It only becomes active once you have given them.</p>
        {decline}
      </AuthShell>
    );
  }

  if (ctx.actor.type === "learner" || ctx.actor.type === "staff") {
    return (
      <AuthShell title="Sign out to carry on" finePrint={finePrint}>
        <p>This page is for the parent or carer the email was sent to, and this device is signed in to a different kind of account. Sign out, then open the link in the email again.</p>
        <SignOutButton />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="A request to approve an account" finePrint={finePrint}>
      {intro}
      {howItWorks}
      {request.parentAccountExists ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Sign in to decide</h2>
          <p>You already have a parent account with this email address. Sign in and we&apos;ll bring you straight back here.</p>
          <div>
            <LinkButton href={signInHref}>Sign in to approve</LinkButton>
          </div>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Create your parent account</h2>
          <p>It uses the email address this link was sent to, so there is nothing more to confirm. You&apos;ll then be asked to approve the request.</p>
          <CreateParentForm token={token} />
          <p className="text-sm">
            Have an account under another address?{" "}
            <Link href={signInHref} className="link">
              Sign in with that instead
            </Link>
            .
          </p>
        </section>
      )}
      {decline}
    </AuthShell>
  );
}
