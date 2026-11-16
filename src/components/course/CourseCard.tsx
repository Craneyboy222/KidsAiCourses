import { Bookmark, Clock, Lock, Play } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CategoryBlock, DifficultyBadge } from "@/components/ui";
import { CATEGORY_LABELS, type CategorySlug } from "@/content/schema";
import { formatMinutes } from "@/lib/dates";
import type { CatalogueCourse } from "@/server/services/catalogue";

export const categoryName = (slug: string): string => CATEGORY_LABELS[slug as CategorySlug] ?? slug.replace(/-/g, " ");

export type CourseCardProps = {
  course: Pick<CatalogueCourse, "slug" | "title" | "tagline" | "category" | "difficulty" | "estimatedMinutes" | "isFree" | "locked" | "saved" | "enrolled">;
  /** Where the card goes: `/courses/…` on the public site, `/explore/…` when signed in. */
  href: string;
  /** `learner` shows locked, saved and started. Neither audience is ever shown a price. */
  audience: "public" | "learner";
  headingLevel?: "h2" | "h3";
};

/**
 * One course in a list. The whole title is the link. A paid course on the Free plan says
 * "Ask a parent to unlock": there is no price here, and no way to add one.
 */
export function CourseCard({ course, href, audience, headingLevel: Heading = "h3" }: CourseCardProps) {
  const learner = audience === "learner";
  return (
    <Card as="li" variant="raised" className="flex h-full flex-col gap-3">
      <CategoryBlock slug={course.category} name={categoryName(course.category)} size="sm" className="self-start" />
      <Heading className="text-xl font-bold">
        <Link href={href} className="link">
          {course.title}
        </Link>
      </Heading>
      <p className="text-ink-muted flex-1">{course.tagline}</p>
      <div className="flex flex-wrap items-center gap-2">
        <DifficultyBadge level={course.difficulty} />
        <Badge icon={<Clock aria-hidden="true" className="size-4" strokeWidth={2.5} />}>{formatMinutes(course.estimatedMinutes)}</Badge>
        {course.isFree && <Badge tone="accent">Free</Badge>}
        {learner && course.locked && (
          <Badge tone="warning" icon={<Lock aria-hidden="true" className="size-4" strokeWidth={2.5} />}>
            Ask a parent to unlock
          </Badge>
        )}
        {learner && course.enrolled && (
          <Badge tone="info" icon={<Play aria-hidden="true" className="size-4" strokeWidth={2.5} />}>
            Started
          </Badge>
        )}
        {learner && course.saved && <Badge icon={<Bookmark aria-hidden="true" className="size-4" strokeWidth={2.5} />}>Saved</Badge>}
      </div>
    </Card>
  );
}

export function CourseGrid({ courses, hrefFor, audience, headingLevel }: { courses: CourseCardProps["course"][]; hrefFor: (slug: string) => string; audience: CourseCardProps["audience"]; headingLevel?: "h2" | "h3" }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <CourseCard key={course.slug} course={course} href={hrefFor(course.slug)} audience={audience} headingLevel={headingLevel} />
      ))}
    </ul>
  );
}
