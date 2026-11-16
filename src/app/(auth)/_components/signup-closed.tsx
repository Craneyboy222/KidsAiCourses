import type { Ctx } from "@/server/context";
import { tMany } from "@/server/copy";
import { AuthShell } from "@/components/layout";
import { Callout, LinkButton } from "@/components/ui";
import { AuthFinePrint } from "./fine-print";

/** Shown in place of every sign-up form while sign-up is closed (decision D2). Collects nothing. */
export async function SignupClosed({ ctx }: { ctx: Pick<Ctx, "db" | "now" | "actor"> }) {
  const copy = await tMany(ctx, ["signup.closed.title", "signup.closed.body"]);
  return (
    <AuthShell title={copy["signup.closed.title"]} finePrint={<AuthFinePrint />}>
      <Callout tone="info" title="Sign-up isn't open just yet">
        <p>{copy["signup.closed.body"]}</p>
      </Callout>
      <div className="flex flex-wrap gap-3">
        <LinkButton href="/" variant="secondary">
          Back to the home page
        </LinkButton>
        <LinkButton href="/signin" variant="ghost">
          I already have an account
        </LinkButton>
      </div>
    </AuthShell>
  );
}
