import type { Metadata } from "next";
import { Breadcrumbs, Callout, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { tDefault } from "@/server/copy";
import { listOwnReports, REPORT_STATUS_LABELS, type ReportReason } from "@/server/services/reports";
import { requireLearnerPage } from "../../_lib/learner-page";

export const metadata: Metadata = { title: "Your reports" };

const REASONS: Record<ReportReason, string> = {
  someone_in_danger: "Someone is in danger",
  inappropriate: "Upsetting or not OK",
  bullying: "Someone being unkind",
  wrong_or_broken: "Wrong or broken",
  guide_mismatch: "Guide doesn't match the tool",
  privacy: "A privacy worry",
  other: "Something else",
};

/** The reports this learner has sent, and where each one has got to (spec 3.10). Available even while the account is paused. */
export default async function OwnReportsPage() {
  const page = await requireLearnerPage("/settings/reports");
  const reports = await listOwnReports(page.ctx, page.learnerId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Your reports" }]} />} title="Your reports" description="Things you've told us about, and what happened next. Only you and our team can see these." />
      <Callout tone="info" title="Need help right now?">
        <p>{tDefault("report.danger.help")}</p>
      </Callout>
      {reports.length === 0 ? (
        <EmptyState title="You haven't sent any reports" description="If something looks wrong, broken or upsetting, use the Report button you'll find on every step, course, project and Coach reply." />
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {reports.map((entry) => (
            <li key={entry.id}>
              <Card padding="sm" className="flex flex-col gap-1">
                <h2 className="text-lg font-bold">{REASONS[entry.reason]}</h2>
                <p className="text-ink-muted text-sm">
                  {entry.targetLabel} · sent {formatDate(entry.createdAt)}
                </p>
                <p>{REPORT_STATUS_LABELS[entry.status] ?? REPORT_STATUS_LABELS.open}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
