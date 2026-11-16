import type { Metadata } from "next";
import { AuthShell } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getCtx } from "@/server/context";
import { tMany } from "@/server/copy";

export const metadata: Metadata = { title: "Thanks for stopping by" };

/**
 * The under-13 page (spec 3.1). Friendly, blames nobody and collects nothing: no form, no
 * "tell me when I'm old enough", no account lookup. It is the same page whoever lands on it,
 * and it does not say what was typed.
 */
export default async function BlockedAgePage() {
  const ctx = await getCtx();
  const copy = await tMany(ctx, ["signup.under13.title", "signup.under13.body", "signup.under13.just_turned_13", "signup.under13.parent"]);
  return (
    <AuthShell title={copy["signup.under13.title"]}>
      <p>{copy["signup.under13.body"]}</p>
      <p>{copy["signup.under13.just_turned_13"]}</p>
      <p className="text-ink-muted">{copy["signup.under13.parent"]}</p>
      <div>
        <LinkButton href="/" variant="secondary">
          Back to the home page
        </LinkButton>
      </div>
    </AuthShell>
  );
}
