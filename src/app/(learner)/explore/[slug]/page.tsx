import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CourseView } from "@/components/course";
import { Breadcrumbs, Callout, LinkButton } from "@/components/ui";
import { getLearnerCoursePage } from "@/server/services/course-page";
import { requireLearnerPage } from "../../_lib/learner-page";
import { AccountOnHold } from "../../_lib/paused";

// The title is generic on purpose: a course this learner may not see must not be named in a tab title either.
export const metadata: Metadata = { title: "Project" };

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The signed-in course page. A course above the learner's age, or one a parent has blocked,
 * answers with the ordinary not-found page: a direct link learns nothing (spec 3.2).
 */
export default async function ExploreCoursePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) notFound();
  const page = await requireLearnerPage(`/explore/${slug}`);
  if (!page.active) return <AccountOnHold title="Project" />;
  const data = await getLearnerCoursePage(page.ctx, page.learnerId, slug);
  if (data.kind === "not_found") notFound();

  const crumbs = <Breadcrumbs items={[{ label: "Explore", href: "/explore" }, { label: data.kind === "ok" ? data.course.title : data.courseTitle }]} />;
  if (data.kind === "taken_down") {
    return (
      <div className="flex flex-col gap-6">
        {crumbs}
        <h1 className="text-3xl font-bold sm:text-4xl">{data.courseTitle}</h1>
        <Callout tone="warning" title="This project has been taken down for now" actions={<LinkButton href="/explore">Explore other projects</LinkButton>}>
          <p>We&apos;ve paused it while we check something. Your progress is saved, and we&apos;ll let you know if it comes back.</p>
        </Callout>
      </div>
    );
  }

  const asked = (await searchParams).asked;
  return (
    <div className="flex flex-col gap-6">
      {crumbs}
      {asked === "sent" && (
        <Callout tone="success" live="status" title="Request sent">
          <p>We&apos;ve asked your parent or carer. You&apos;ll see this open up here when they say yes.</p>
        </Callout>
      )}
      {asked === "failed" && (
        <Callout tone="danger" live="alert" title="That request didn't send">
          <p>Nothing was lost. Give it a minute, then try again.</p>
        </Callout>
      )}
      <CourseView
        content={data.course}
        courseId={data.courseId}
        mode={{
          kind: "learner",
          learnerId: page.learnerId,
          enrolment: data.enrolment,
          gate: data.gate,
          locked: data.locked,
          saved: data.saved,
          unlockAsked: data.unlockAsked,
          resumeKey: data.resumeKey,
          playerBasePath: `/learn/${data.course.slug}`,
        }}
      />
    </div>
  );
}
