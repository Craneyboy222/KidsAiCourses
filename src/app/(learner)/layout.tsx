import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SignOutButton } from "@/app/(auth)/_components/sign-out-button";
import { UsageHeartbeat } from "@/components/course/use-heartbeat";
import { LearnerShell } from "@/components/layout";
import { Callout } from "@/components/ui";
import { getCtx } from "@/server/context";
import { logWarn } from "@/server/log";
import { getLearnerSummary } from "@/server/services/family";
import { WAITING_PATH, resolveAfterSignIn } from "@/server/services/sign-in";
import { checkLearningAllowed, type LearningAllowed } from "@/server/services/usage";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const TITLES: Record<Extract<LearningAllowed, { allowed: false }>["reason"], string> = {
  paused: "Your account is paused",
  consent: "A parent needs to finish your permissions",
  not_active: "Your account isn't switched on",
  quiet_hours: "It's quiet hours",
  time_cap: "That's your learning time for today",
};

/**
 * The frame around every learner screen except the course player (which has its own, in
 * `(player)`): the tab bar or rail, the nickname and generated avatar, and the notices a learner
 * needs to see wherever they are: account paused, quiet hours, the daily cap. It also carries the
 * usage heartbeat for these pages.
 *
 * Learners only. Each page still does its own check (`requireLearnerPage`), including the
 * onboarding redirect, which cannot live here because this layout also wraps `/onboarding`.
 * Nothing in this area is indexed, and there is no price, advert or tracking script anywhere in it.
 */
export default async function LearnerLayout({ children }: { children: ReactNode }) {
  const ctx = await getCtx();
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") redirect("/signin");
  if (ctx.actor.type !== "learner") redirect((await resolveAfterSignIn(ctx)).path);
  if (ctx.actor.status === "pending_parent") redirect(WAITING_PATH);
  const summary = await getLearnerSummary(ctx, ctx.actor.userId);

  // The notice is a courtesy: every page and service makes the real check. If it cannot be worked
  // out, the frame still renders and the pages decide.
  let allowed: LearningAllowed | null = null;
  try {
    allowed = await checkLearningAllowed(ctx, ctx.actor.userId);
  } catch (error) {
    logWarn("learner.layout.notice_unavailable", { error: error instanceof Error ? error.message : String(error) });
  }

  let notice: ReactNode = null;
  if (allowed && !allowed.allowed) {
    notice = (
      <Callout tone={allowed.reason === "quiet_hours" || allowed.reason === "time_cap" ? "info" : "warning"} title={TITLES[allowed.reason]}>
        <p>{allowed.message}</p>
        {(allowed.reason === "quiet_hours" || allowed.reason === "time_cap") && (
          <p className="text-ink-muted text-sm">
            A parent or carer sets these times.{" "}
            <Link href="/settings#parent-view" className="link">
              What my parent can see and set
            </Link>
          </p>
        )}
      </Callout>
    );
  } else if (allowed?.allowed && allowed.minutesLeftToday !== null && allowed.minutesLeftToday <= 10) {
    notice = (
      <Callout tone="info" title={allowed.minutesLeftToday <= 1 ? "About a minute of learning time left today" : `About ${allowed.minutesLeftToday} minutes of learning time left today`}>
        <p>Your work saves by itself, so nothing is lost when the time is up.</p>
      </Callout>
    );
  }

  return (
    <LearnerShell nickname={summary.nickname} avatarSeed={summary.avatarSeed} account={<SignOutButton />} notices={notice ?? undefined}>
      {/* Time on these pages counts towards the daily cap too. Only while learning is allowed: after that there is nothing to count. */}
      {allowed?.allowed && <UsageHeartbeat />}
      {children}
    </LearnerShell>
  );
}
