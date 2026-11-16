import type { Metadata } from "next";
import { Callout } from "@/components/ui";
import { getCtx } from "@/server/context";
import { isAppError } from "@/server/errors";
import { formatInviteCode, isInviteCodeShape, peekInviteCode } from "@/server/services/invite";
import { JoinForm } from "../join-form";
import { JoinShell } from "../join-shell";

export const metadata: Metadata = { title: "Use your code" };

/**
 * A link with the code already in it. The page says only whether the code is still worth using:
 * never who it is for. The username is still needed, so the link by itself opens nothing.
 */
export default async function JoinWithCodePage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  const code = decodeURIComponent(inviteCode).slice(0, 40);
  const ctx = await getCtx();
  let state: "usable" | "expired" | "unknown" = "unknown";
  try {
    // Signed in or not, this look-up is counted against the caller's address.
    state = await peekInviteCode({ ...ctx, actor: { type: "anonymous" } }, code);
  } catch (error) {
    if (!isAppError(error) || error.code !== "rate_limited") throw error;
  }

  return (
    <JoinShell>
      {state === "expired" && (
        <Callout tone="warning" title="This code has run out">
          <p>Codes last 72 hours. Ask your parent or carer to make a new one from their dashboard, then enter it below.</p>
        </Callout>
      )}
      {state === "unknown" && (
        <Callout tone="warning" title="We don't recognise that code">
          <p>It may have been used already or replaced by a newer one. Check the code and type it in below, or ask your parent or carer for a new one.</p>
        </Callout>
      )}
      <JoinForm code={state === "usable" && isInviteCodeShape(code) ? formatInviteCode(code) : ""} />
    </JoinShell>
  );
}
