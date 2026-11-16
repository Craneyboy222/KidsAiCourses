import type { Metadata } from "next";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { Callout, EmptyState, PageHeader } from "@/components/ui";
import { assertCan } from "@/server/authz";
import { listApprovals } from "@/server/services/approvals";
import { ApprovalCard } from "../_components/approval-card";
import { toCardItem } from "../_lib/view";

export const metadata: Metadata = { title: "Approvals" };

/**
 * The approvals inbox (spec 3.6): requests to use an outside tool, tools a parent would have to
 * run themselves, and requests to unlock a course, in one list. Each says what it is, what the
 * tool's own terms are and what approving means. The list is for the signed-in parent's family.
 */
export default async function ApprovalsPage() {
  const ctx = await requireParentPage();
  const { familyId } = ctx.actor;
  assertCan(ctx.actor, "family.read", { familyId });
  const items = await listApprovals(ctx, familyId);
  const pending = items.filter((item) => item.status === "pending");
  const answered = items.filter((item) => item.status !== "pending").slice(0, 30);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <PageHeader title="Approvals" description="Things your children have asked you to say yes or no to. They are told your answer in the app." />

      <section aria-labelledby="waiting-title" className="flex flex-col gap-4">
        <h2 id="waiting-title" className="text-2xl font-bold">
          Waiting for you
        </h2>
        {pending.length === 0 ? (
          <EmptyState headingLevel="h3" title="Nothing is waiting" description="When a child asks to use an outside tool or to unlock a course, it appears here and we email you." />
        ) : (
          pending.map((item) => <ApprovalCard key={item.key} item={toCardItem(item)} headingLevel="h3" />)
        )}
      </section>

      <Callout tone="info" title="About outside tools">
        <p>
          Projects are made in real tools run by other companies. Each has its own terms and privacy policy, and what your child types into a tool is handled by that company, not by us. We only see what they send back to us as their finished work.
          We will never ask you or your child for a password, code or key for any of them.
        </p>
      </Callout>

      {answered.length > 0 && (
        <section aria-labelledby="answered-title" className="flex flex-col gap-4">
          <h2 id="answered-title" className="text-2xl font-bold">
            Already answered
          </h2>
          {answered.map((item) => (
            <ApprovalCard key={item.key} item={toCardItem(item)} headingLevel="h3" />
          ))}
        </section>
      )}
    </div>
  );
}
