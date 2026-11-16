import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout";
import { safeNextPath } from "@/lib/protected-paths";
import { getCtx } from "@/server/context";
import { TWO_FACTOR_SETUP_PATH, resolveAfterSignIn, signedInFacts } from "@/server/services/sign-in";
import { AuthFinePrint } from "../../../_components/fine-print";
import { SignOutButton } from "../../../_components/sign-out-button";
import { TwoFactorSetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up two-step sign-in" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * First-time enrolment. Every member of staff must do this before Studio opens (spec 3.1); a
 * parent may choose to. Signed in with a password only at this point.
 */
export default async function TwoFactorSetupPage({ searchParams }: { searchParams: Search }) {
  const next = safeNextPath(one((await searchParams).next), "");
  const ctx = await getCtx();
  if (ctx.actor.type !== "staff" && ctx.actor.type !== "parent") redirect(`/signin?as=parent&next=${encodeURIComponent(TWO_FACTOR_SETUP_PATH)}`);
  const facts = await signedInFacts(ctx);
  // Already enrolled: nothing to set up.
  if (facts.kind === "staff" && facts.twoFactorEnabled) redirect((await resolveAfterSignIn(ctx, next)).path);

  return (
    <AuthShell
      title="Set up two-step sign-in"
      description={
        ctx.actor.type === "staff"
          ? "Everyone on the team needs this before the staff area opens. It takes about two minutes, and you need an authenticator app on your phone."
          : "An extra code from an app on your phone, asked for each time you sign in. You need an authenticator app."
      }
      finePrint={<AuthFinePrint />}
    >
      <TwoFactorSetupForm next={next} />
      <SignOutButton label="Sign out and do this later" />
    </AuthShell>
  );
}
