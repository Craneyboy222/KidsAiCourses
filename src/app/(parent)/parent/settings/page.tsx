import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { A11Y_COOKIE, A11yPreferences, Card, EmptyState, LinkButton, PageHeader, parseA11yPrefs } from "@/components/ui";
import { PARENT_VIEW_PARENT_HIDDEN_KEYS, PARENT_VIEW_PARENT_SEES_KEYS } from "@/content/copy/en-GB";
import { formatDate } from "@/lib/dates";
import { assertCan } from "@/server/authz";
import { tMany } from "@/server/copy";
import { logWarn } from "@/server/log";
import { getFamily, listChildren } from "@/server/services/family";
import { listOwnReports, REPORT_STATUS_LABELS, type ReportReason } from "@/server/services/reports";

export const metadata: Metadata = { title: "Settings" };

const REASONS: Record<ReportReason, string> = {
  someone_in_danger: "Someone is in danger",
  inappropriate: "Upsetting or not OK",
  bullying: "Someone being unkind",
  wrong_or_broken: "Wrong or broken",
  guide_mismatch: "Guide doesn't match the tool",
  privacy: "A privacy worry",
  other: "Something else",
};

type OwnReport = Awaited<ReturnType<typeof listOwnReports>>[number];

/**
 * The parent's own settings: how the site looks for them, their sign-in, who is in the family,
 * what they can and cannot see of a child's account, and the reports they have sent us.
 */
export default async function ParentSettingsPage() {
  const ctx = await requireParentPage();
  const { familyId, userId } = ctx.actor;
  assertCan(ctx.actor, "family.read", { familyId });
  const [children, family, copy] = await Promise.all([
    listChildren(ctx, familyId),
    getFamily(ctx, familyId),
    tMany(ctx, ["parent_view.title.parent", "parent_view.intro.parent", "parent_view.safeguarding", ...PARENT_VIEW_PARENT_SEES_KEYS, ...PARENT_VIEW_PARENT_HIDDEN_KEYS]),
  ]);
  // Their own reports only: the service refuses any other user id.
  let reports: OwnReport[] = [];
  try {
    reports = await listOwnReports(ctx, userId);
  } catch (error) {
    logWarn("parent.settings.reports_unavailable", { error: error instanceof Error ? error.message : String(error) });
  }
  const prefs = parseA11yPrefs((await cookies()).get(A11Y_COOKIE)?.value);

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <PageHeader title="Settings" description="Your own account, and how the site looks for you." />

      <section aria-labelledby="family-title" className="flex flex-col gap-3">
        <h2 id="family-title" className="text-2xl font-bold">
          Your family
        </h2>
        {children.length === 0 ? (
          <p>You haven&apos;t added a child yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {children.map((child) => (
              <li key={child.learnerId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={`/parent/children/${child.learnerId}`} className="link font-bold">
                  {child.nickname}
                </Link>
                <span className="text-ink-muted">
                  age {child.age}, username {child.username}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-ink-muted">{family?.ownerUserId === userId ? "You set up this family account." : "You are a parent or carer on this family account."}</p>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/parent/children/new" variant="secondary">
            Add a child
          </LinkButton>
          <LinkButton href="/parent/billing" variant="ghost">
            Plan and billing
          </LinkButton>
        </div>
      </section>

      <section aria-labelledby="signin-title" className="flex flex-col gap-3">
        <h2 id="signin-title" className="text-2xl font-bold">
          Signing in
        </h2>
        <p>You sign in with your email address and a password, or with a one-time link we email you. To choose a new password, use the reset page: we email you a link, and your other devices are signed out.</p>
        <div>
          <LinkButton href="/reset" variant="secondary">
            Change my password
          </LinkButton>
        </div>
        <p className="text-ink-muted">A child&apos;s password is reset from their own page on your dashboard.</p>
      </section>

      <section id="what-you-see" aria-labelledby="see-title" className="flex scroll-mt-24 flex-col gap-3">
        <h2 id="see-title" className="text-2xl font-bold">
          {copy["parent_view.title.parent"]}
        </h2>
        <p>{copy["parent_view.intro.parent"]} We show your child the same list on their settings page.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Card variant="plain" padding="sm" className="flex flex-col gap-2">
            <h3 className="font-bold">You can see</h3>
            <ul className="flex list-disc flex-col gap-1 pl-6">
              {PARENT_VIEW_PARENT_SEES_KEYS.map((key) => (
                <li key={key}>{copy[key]}</li>
              ))}
            </ul>
          </Card>
          <Card variant="plain" padding="sm" className="flex flex-col gap-2">
            <h3 className="font-bold">Stays private to them</h3>
            <ul className="flex list-disc flex-col gap-1 pl-6">
              {PARENT_VIEW_PARENT_HIDDEN_KEYS.map((key) => (
                <li key={key}>{copy[key]}</li>
              ))}
              <li>What they write in a reflection or an ethics checkpoint.</li>
              <li>Their quiz answers.</li>
              <li>Work that hasn&apos;t been accepted yet.</li>
            </ul>
          </Card>
        </div>
        <p>You can also set a daily time limit and quiet hours, block subjects or courses, approve tools, pause the account, and download or delete their data.</p>
        <p className="text-ink-muted">If something suggests a child might be in danger, our safeguarding lead may contact you. That is the only time more is shared.</p>
      </section>

      <section aria-labelledby="look-title" className="flex flex-col gap-3">
        <h2 id="look-title" className="text-2xl font-bold">
          How the site looks
        </h2>
        <p className="text-ink-muted">These are saved on this device and apply straight away.</p>
        <A11yPreferences initial={prefs} headingLevel="h3" />
      </section>

      <section id="your-reports" aria-labelledby="reports-title" className="flex scroll-mt-24 flex-col gap-3">
        <h2 id="reports-title" className="text-2xl font-bold">
          Your reports
        </h2>
        <p className="text-ink-muted">Things you have told us about, and what happened next. Only you and our team can see these. Reports your child has sent are private to them.</p>
        {reports.length === 0 ? (
          <EmptyState headingLevel="h3" title="You haven't sent any reports" description="If something on the site looks wrong, broken or worrying, use the Report button you'll find on courses, projects and guides." />
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.map((entry) => (
              <Card as="li" key={entry.id} padding="sm" className="flex flex-col gap-1">
                <h3 className="text-lg font-bold">{REASONS[entry.reason]}</h3>
                <p className="text-ink-muted text-sm">
                  {entry.targetLabel} · sent {formatDate(entry.createdAt)}
                </p>
                <p>{REPORT_STATUS_LABELS[entry.status] ?? REPORT_STATUS_LABELS.open}</p>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
