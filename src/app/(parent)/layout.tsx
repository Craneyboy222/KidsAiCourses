import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/app/(auth)/_components/sign-out-button";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { ParentShell, type ParentChildLink } from "@/components/layout";
import { Callout } from "@/components/ui";
import { assertCan } from "@/server/authz";
import { logWarn } from "@/server/log";
import { countPendingApprovals } from "@/server/services/approvals";
import { missingRequiredConsents } from "@/server/services/consent";
import { listChildren } from "@/server/services/family";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The frame around every parent screen: the top bar, the approvals badge and the child switcher
 * (spec 3.6: "switch between children from any parent screen"). Parents and carers only: anyone
 * else is sent to sign in, or to their own home.
 */
export default async function ParentLayout({ children }: { children: ReactNode }) {
  const ctx = await requireParentPage();
  const { familyId } = ctx.actor;
  assertCan(ctx.actor, "family.read", { familyId });

  const learners = (await listChildren(ctx, familyId)).filter((learner) => learner.status !== "pending_deletion");
  const childLinks: ParentChildLink[] = learners.map((learner) => ({
    id: learner.learnerId,
    nickname: learner.nickname,
    avatarSeed: learner.avatarSeed,
    href: `/parent/children/${learner.learnerId}`,
  }));

  // The badge is a convenience. If the approvals service is unavailable, there is simply no badge.
  let approvalsCount = 0;
  try {
    approvalsCount = await countPendingApprovals(ctx, familyId);
  } catch (error) {
    logWarn("parent.layout.approvals_unavailable", { error: error instanceof Error ? error.message : String(error) });
  }

  // A child whose permissions are not finished cannot use their account: say so on every screen.
  const waiting: Array<{ id: string; nickname: string }> = [];
  for (const learner of learners) {
    if ((await missingRequiredConsents(ctx, learner.learnerId)).length > 0) waiting.push({ id: learner.learnerId, nickname: learner.nickname });
  }

  return (
    <ParentShell
      childLinks={childLinks}
      approvalsCount={approvalsCount}
      account={<SignOutButton />}
      notices={
        waiting.length > 0
          ? waiting.map((child) => (
              <Callout key={child.id} tone="warning" title={`${child.nickname}'s account is waiting for your permissions`}>
                <p>
                  They can&apos;t use their account until this is done.{" "}
                  <Link href={`/parent/children/${child.id}/consent`} className="link">
                    Review {child.nickname}&apos;s permissions
                  </Link>
                </p>
              </Callout>
            ))
          : undefined
      }
    >
      {children}
    </ParentShell>
  );
}
