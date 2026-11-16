import type { Metadata } from "next";
import Link from "next/link";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { Badge, Callout, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { listParentNotices, type ParentNotice } from "@/server/services/parent-dashboard";
import { MarkReadForm } from "../_components/notice-actions";

export const metadata: Metadata = { title: "Notices" };

function NoticeCard({ notice }: { notice: ParentNotice }) {
  const titleId = `notice-${notice.id}`;
  return (
    <Card as="li" variant={notice.read ? "plain" : "outline"} padding="sm" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={notice.category === "safety" ? "warning" : "neutral"}>{notice.category === "safety" ? "Safety notice" : "Account"}</Badge>
        {notice.urgent && <Badge tone="danger">Important</Badge>}
        <Badge tone={notice.read ? "neutral" : "accent"}>{notice.read ? "Read" : "New"}</Badge>
        <span className="text-ink-muted text-sm">{formatDateTime(notice.at)}</span>
      </div>
      <h3 id={titleId} className="text-lg font-bold">
        {notice.title}
      </h3>
      <p>{notice.body}</p>
      <div className="flex flex-wrap items-center gap-3">
        {notice.href && (
          <Link href={notice.href} className="link">
            Open<span className="sr-only">: {notice.title}</span>
          </Link>
        )}
        {!notice.read && <MarkReadForm id={notice.id} label="Mark as read" describedBy={titleId} />}
      </div>
    </Card>
  );
}

/**
 * Safety and account notices for the signed-in parent, newest first, with read state (spec 3.6,
 * 3.10). These are the parent's own notifications: nothing here is chosen by an id in the address.
 */
export default async function NoticesPage() {
  const ctx = await requireParentPage();
  const { notices, unread } = await listParentNotices(ctx);
  const safety = notices.filter((notice) => notice.category === "safety");
  const account = notices.filter((notice) => notice.category === "account");

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Notices"
        description="Safety notices and news about your family's accounts. Safety notices are always sent straight away, and by email too."
        actions={unread > 0 ? <MarkReadForm id="all" label={unread === 1 ? "Mark it as read" : `Mark all ${unread} as read`} /> : undefined}
      />

      <Callout tone="info" title="What a safety notice tells you">
        <p>
          That something about a child&apos;s account needed attention, and what we have done or what you can do. It does not include what your child wrote or said, or the detail of any concern: that is handled by our safeguarding lead, who will
          contact you directly if they need to. If you are worried that a child is in immediate danger, call 999.
        </p>
      </Callout>

      {notices.length === 0 ? (
        <EmptyState title="No notices yet" description="If something needs your attention, it will appear here and we'll email you." />
      ) : (
        <>
          <section aria-labelledby="safety-title" className="flex flex-col gap-3">
            <h2 id="safety-title" className="text-2xl font-bold">
              Safety notices
            </h2>
            {safety.length === 0 ? (
              <p className="text-ink-muted">There are no safety notices.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {safety.map((notice) => (
                  <NoticeCard key={notice.id} notice={notice} />
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="account-title" className="flex flex-col gap-3">
            <h2 id="account-title" className="text-2xl font-bold">
              Account notices
            </h2>
            {account.length === 0 ? (
              <p className="text-ink-muted">There are no account notices.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {account.map((notice) => (
                  <NoticeCard key={notice.id} notice={notice} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <p className="text-ink-muted">
        Looking for something you reported to us?{" "}
        <Link href="/parent/settings#your-reports" className="link">
          Your reports
        </Link>
      </p>
    </div>
  );
}
