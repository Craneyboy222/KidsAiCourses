import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout";
import { Callout } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getCtx } from "@/server/context";
import { tMany } from "@/server/copy";
import { resolveAfterSignIn } from "@/server/services/sign-in";
import { getPendingTeenStatus } from "@/server/services/teen-signup";
import { AuthFinePrint } from "../../../_components/fine-print";
import { SignOutButton } from "../../../_components/sign-out-button";
import { ResendApprovalForm } from "./resend-form";

export const metadata: Metadata = { title: "Waiting for your parent or carer" };

/** Where a teen waits after signing up. Says plainly what is locked and when the account is deleted. */
export default async function TeenWaitingPage() {
  const ctx = await getCtx();
  if (ctx.actor.type !== "learner") redirect("/signin");
  const status = await getPendingTeenStatus(ctx);
  // Approved (or never pending): there is nothing to wait for.
  if (!status.pending) redirect((await resolveAfterSignIn(ctx)).path);

  const copy = await tMany(ctx, ["signup.pending_parent.title", "signup.pending_parent.body", "signup.teen.locked_until_approved", "signup.teen.deleted_after_7_days"]);

  return (
    <AuthShell title={copy["signup.pending_parent.title"]} description={copy["signup.pending_parent.body"]} finePrint={<AuthFinePrint />}>
      <Callout tone="warning" title={status.expiresAt ? `Your account is deleted on ${formatDate(status.expiresAt)} if nobody approves it` : "Your account is deleted after 7 days if nobody approves it"}>
        <p>{copy["signup.teen.deleted_after_7_days"]}</p>
      </Callout>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">What you can do while you wait</h2>
        <p>{copy["signup.teen.locked_until_approved"]}</p>
        <p>
          <Link href="/courses" className="link">
            Have a look at the courses
          </Link>{" "}
          and watch a trailer, so you know what you want to make first.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Nothing arrived?</h2>
        <p>Ask your parent or carer to check their junk folder. The email comes from us and has a button to approve your account.</p>
        <ResendApprovalForm emailsSent={status.emailsSent} canResend={status.canResend} />
      </section>

      <SignOutButton />
    </AuthShell>
  );
}
