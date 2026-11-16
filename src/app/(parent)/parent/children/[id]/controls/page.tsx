import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { Breadcrumbs, Callout, LinkButton, PageHeader } from "@/components/ui";
import { CATEGORY_LABELS, CATEGORY_SLUGS, type CategorySlug } from "@/content/schema";
import { formatDate, formatMinutes } from "@/lib/dates";
import { DAILY_CAP_CHOICES, minutesToClockValue } from "@/lib/parents/controls-rules";
import { getControlsForParent, listBlockableCourses } from "@/server/services/parent-controls";
import { ControlsForm } from "../../../_components/controls-form";
import { UUID, loadOr404 } from "../../../_lib/view";

export const metadata: Metadata = { title: "Time and limits" };

type Props = { params: Promise<{ id: string }> };

const DIFFICULTY: Record<string, string> = { starter: "Starter", builder: "Builder", pro: "Pro" };
const categoryLabel = (slug: string | null): string => (slug && slug in CATEGORY_LABELS ? CATEGORY_LABELS[slug as CategorySlug] : "Other");

/**
 * The limits a parent sets for one child (spec 3.6): daily time, quiet hours, blocked subjects
 * and courses, and approval for Pro courses. Until something is saved the site's defaults apply,
 * and the form shows them.
 */
export default async function ChildControlsPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireParentPage();
  const view = await loadOr404(() => getControlsForParent(ctx, id));
  const { learner, controls } = view;
  const name = learner.nickname;
  const base = `/parent/children/${learner.learnerId}`;

  const header = (
    <PageHeader
      title={`${name}'s time and limits`}
      description="Changes apply from their next page or step. Their work is always saved first."
      breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/parent" }, { label: name, href: base }, { label: "Time and limits" }]} />}
    />
  );

  if (view.independent || learner.status === "pending_deletion") {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        {header}
        <Callout
          tone="info"
          title={view.independent ? `${name} is 18 and runs their own account` : `${name}'s account is set to be deleted`}
          actions={
            <LinkButton href={view.independent ? base : "/parent/privacy"} variant="secondary">
              {view.independent ? `Back to ${name}` : "Go to Privacy"}
            </LinkButton>
          }
        >
          <p>{view.independent ? "Their limits are no longer yours to change." : "Limits can't be changed while the account is closed. You can undo the deletion from your Privacy page."}</p>
        </Callout>
      </div>
    );
  }

  const courses = await loadOr404(() => listBlockableCourses(ctx, id));
  const blockedCourses = new Set(controls.blockedCourseIds);
  const blockedCategories = new Set(controls.blockedCategories);
  const cap = controls.dailyMinutesCap;
  const choices: number[] = [...DAILY_CAP_CHOICES];
  // A limit set some other way (or an older value) must still appear, or saving would silently change it.
  if (cap !== null && !choices.includes(cap)) choices.push(cap);
  choices.sort((a, b) => a - b);
  const quietOn = controls.quietStartMin !== controls.quietEndMin;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {header}
      {!view.customised && (
        <Callout tone="info" title="These are our starting settings">
          <p>You haven&apos;t changed anything for {name} yet, so the form shows what applies now: no daily limit, and quiet hours overnight. Change what you like and save.</p>
        </Callout>
      )}
      {view.customised && view.updatedAt && <p className="text-ink-muted">Last changed on {formatDate(view.updatedAt)}.</p>}
      {controls.paused && (
        <Callout tone="warning" title={`${name}'s account is paused`} actions={<LinkButton href={`${base}#pause-title`} variant="secondary">Go to pause</LinkButton>}>
          <p>Limits can still be changed. They will apply once the account is switched back on.</p>
        </Callout>
      )}
      <ControlsForm
        learnerId={learner.learnerId}
        nickname={name}
        dailyCap={cap === null ? "none" : String(cap)}
        capOptions={[{ value: "none", label: "No daily limit" }, ...choices.map((minutes) => ({ value: String(minutes), label: `${formatMinutes(minutes)} a day` }))]}
        quietEnabled={quietOn}
        quietStart={minutesToClockValue(quietOn ? controls.quietStartMin : 21 * 60)}
        quietEnd={minutesToClockValue(quietOn ? controls.quietEndMin : 7 * 60)}
        categories={CATEGORY_SLUGS.map((slug) => ({ slug, label: CATEGORY_LABELS[slug], blocked: blockedCategories.has(slug) }))}
        courses={courses.map((course) => ({ id: course.id, title: course.title, detail: [categoryLabel(course.category), course.difficulty ? DIFFICULTY[course.difficulty] : null].filter(Boolean).join(" · "), blocked: blockedCourses.has(course.id) }))}
        requireApprovalForPro={controls.requireApprovalForPro}
      />
    </div>
  );
}
