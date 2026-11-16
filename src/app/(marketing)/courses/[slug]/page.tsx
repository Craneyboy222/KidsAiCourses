import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CourseView } from "@/components/course";
import { Breadcrumbs } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";
import { getCtx } from "@/server/context";
import { getPublicCoursePage } from "@/server/services/course-page";

type Params = Promise<{ slug: string }>;

const validSlug = (slug: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 120;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await getCtx();
  // A signed-in learner is redirected by the page; they get no course details from here either.
  const page = validSlug(slug) && ctx.actor.type !== "learner" ? await getPublicCoursePage(ctx, slug) : null;
  if (!page) return { title: "Course not found", robots: { index: false, follow: false } };
  return {
    title: page.course.title,
    description: page.course.tagline,
    openGraph: { title: `${page.course.title} · ${BRAND_NAME}`, description: page.course.tagline, type: "article" },
    alternates: { canonical: `/courses/${page.course.slug}` },
  };
}

/**
 * The public course page (spec Section 5: "public course trailer"). The same `CourseView` learners
 * see, with an outline only and a "Get started" call to action instead of Start. No prices.
 *
 * No `<main>` here: the marketing layout (owned by the marketing slice) provides the page frame.
 */
export default async function PublicCoursePage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const ctx = await getCtx();
  // Their own course page applies the age gate, parent blocks and the lock.
  if (ctx.actor.type === "learner") redirect(`/explore/${slug}`);
  const page = await getPublicCoursePage(ctx, slug);
  if (!page) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <Breadcrumbs items={[{ label: "Courses", href: "/courses" }, { label: page.course.title }]} />
      <CourseView content={page.course} courseId={page.courseId} mode={{ kind: "public", tasterHref: page.firstTasterStepKey ? `/courses/${page.course.slug}/taster` : null }} />
    </div>
  );
}
