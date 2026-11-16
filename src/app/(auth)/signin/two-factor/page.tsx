import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout";
import { safeNextPath } from "@/lib/protected-paths";
import { getCtx } from "@/server/context";
import { TWO_FACTOR_SETUP_PATH, resolveAfterSignIn } from "@/server/services/sign-in";
import { AuthFinePrint } from "../../_components/fine-print";
import { SignOutButton } from "../../_components/sign-out-button";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Enter your two-step code" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * The second step of sign-in. The password was accepted and Better Auth is holding a short-lived
 * challenge; there is no session until the code is right.
 */
export default async function TwoFactorPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const next = safeNextPath(one(params.next), "");
  const ctx = await getCtx();
  // Already through, or signed in without two-step set up yet: this page has nothing to ask.
  let passwordOnlySession = false;
  if (ctx.actor.type === "staff" && !ctx.actor.twoFactorVerified) {
    const after = await resolveAfterSignIn(ctx, next);
    if (after.path === TWO_FACTOR_SETUP_PATH) redirect(TWO_FACTOR_SETUP_PATH);
    // A session from before two-step was switched on (say, on a second device). A code entered
    // here cannot upgrade it, and every sign-in page sends it straight back here, so the only way
    // out is to end it and sign in afresh.
    passwordOnlySession = true;
  } else if (ctx.actor.type !== "anonymous" && ctx.actor.type !== "system") {
    redirect((await resolveAfterSignIn(ctx, next)).path);
  }
  if (passwordOnlySession) {
    return (
      <AuthShell title="Sign in again to carry on" description="Two-step sign-in has been switched on since this device last signed in, so we need your password and your code together." finePrint={<AuthFinePrint />}>
        <SignOutButton label="Sign out and sign in again" />
      </AuthShell>
    );
  }
  const useBackup = one(params.method) === "backup";
  const query = new URLSearchParams();
  if (!useBackup) query.set("method", "backup");
  if (next) query.set("next", next);
  const switchHref = query.size > 0 ? `/signin/two-factor?${query.toString()}` : "/signin/two-factor";

  return (
    <AuthShell
      title={useBackup ? "Use a backup code" : "Enter your two-step code"}
      description={
        useBackup
          ? "Enter one of the backup codes you saved when you set up two-step sign-in. Each code works once."
          : "Open your authenticator app and enter the six-digit code it shows for this site."
      }
      footer={
        <p>
          <Link href="/signin?as=parent" className="link">
            Back to sign in
          </Link>
        </p>
      }
      finePrint={<AuthFinePrint />}
    >
      <TwoFactorForm next={next} method={useBackup ? "backup" : "totp"} />
      <p className="text-sm">
        <Link href={switchHref} className="link">
          {useBackup ? "Use my authenticator app instead" : "I can't get to my app: use a backup code"}
        </Link>
      </p>
    </AuthShell>
  );
}
