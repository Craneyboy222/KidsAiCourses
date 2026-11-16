import { Bell, Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CourseGrid, categoryName } from "@/components/course";
import { Card, CategoryBlock, EmptyState, Icon, LinkButton, ProgressBar } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getLearnerHome } from "@/server/services/learner-home";
import { requireLearnerPage } from "../_lib/learner-page";
import { AccountOnHold } from "../_lib/paused";

export const metadata: Metadata = { title: "Home" };

const exploreHref = (slug: string) => `/explore/${slug}`;

/**
 * Learner home (spec 3.2): pick up where you left off, things made for you, what's new, free
 * projects, saved for later, and any notices. A Server Component with no client code of its own.
 * No streaks, points, rankings or other learners: by design.
 */
export default async function LearnerHomePage() {
  const page = await requireLearnerPage("/home");
  if (!page.active) return <AccountOnHold title={`Hi ${page.summary.nickname}`} />;
  const home = await getLearnerHome(page.ctx, page.learnerId);
  const nothingStarted = home.continueLearning.length === 0 && home.finished.length === 0;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold sm:text-4xl">Hi {page.summary.nickname}</h1>
        <p className="text-ink-muted text-lg">{nothingStarted ? "Pick something you'd like to make." : "Ready to carry on?"}</p>
      </header>

      {home.notices.length > 0 && (
        <section aria-labelledby="home-notices" className="flex flex-col gap-3">
          <h2 id="home-notices" className="flex items-center gap-2 text-2xl font-bold">
            <Icon icon={Bell} /> Notices
          </h2>
          <ul className="flex flex-col gap-3">
            {home.notices.map((notice) => (
              <Card as="li" key={notice.id} padding="sm" className="flex flex-col gap-1">
                <p className="font-bold">{notice.href ? <Link href={notice.href} className="link">{notice.title}</Link> : notice.title}</p>
                <p>{notice.body}</p>
                <p className="text-ink-muted text-sm">{formatDate(notice.at)}</p>
              </Card>
            ))}
          </ul>
          <p>
            <Link href="/settings#notifications" className="link">
              See all notices
            </Link>
          </p>
        </section>
      )}

      <section aria-labelledby="home-continue" className="flex flex-col gap-4">
        <h2 id="home-continue" className="text-2xl font-bold">
          Continue learning
        </h2>
        {home.continueLearning.length === 0 ? (
          <EmptyState
            headingLevel="h3"
            icon={<Icon icon={Compass} size="xl" />}
            title={home.finished.length > 0 ? "Nothing on the go" : "You haven't started a project yet"}
            description="Projects you start show up here, so you can pick up at the exact step you left."
            action={<LinkButton href="/explore">Explore projects</LinkButton>}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {home.continueLearning.map((item) => (
              <Card as="li" key={item.id} variant="raised" className="flex flex-col gap-3">
                <CategoryBlock slug={item.category} name={categoryName(item.category)} size="sm" className="self-start" />
                <h3 className="text-xl font-bold">
                  <Link href={exploreHref(item.courseSlug)} className="link">
                    {item.courseTitle}
                  </Link>
                </h3>
                <ProgressBar label="Progress" value={item.completedSteps} max={Math.max(item.totalSteps, 1)} valueText={`${item.completedSteps} of ${item.totalSteps} steps done`} />
                <div>
                  <LinkButton href={`/learn/${item.courseSlug}`}>
                    Continue<span className="sr-only"> {item.courseTitle}</span>
                  </LinkButton>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>

      {home.madeForYou.length > 0 && (
        <section aria-labelledby="home-for-you" className="flex flex-col gap-4">
          <h2 id="home-for-you" className="text-2xl font-bold">
            Made for you
          </h2>
          <p className="text-ink-muted">
            Based on the interests you picked.{" "}
            <Link href="/settings#profile" className="link">
              Change your interests
            </Link>
          </p>
          <CourseGrid courses={home.madeForYou} hrefFor={exploreHref} audience="learner" />
        </section>
      )}

      {home.newCourses.length > 0 && (
        <section aria-labelledby="home-new" className="flex flex-col gap-4">
          <h2 id="home-new" className="text-2xl font-bold">
            {home.newIsThisWeek ? "New this week" : "Newest projects"}
          </h2>
          <CourseGrid courses={home.newCourses} hrefFor={exploreHref} audience="learner" />
        </section>
      )}

      {home.freeCourses.length > 0 && (
        <section aria-labelledby="home-free" className="flex flex-col gap-4">
          <h2 id="home-free" className="text-2xl font-bold">
            Free to start
          </h2>
          <CourseGrid courses={home.freeCourses} hrefFor={exploreHref} audience="learner" />
        </section>
      )}

      <section aria-labelledby="home-saved" className="flex flex-col gap-4">
        <h2 id="home-saved" className="text-2xl font-bold">
          Saved for later
        </h2>
        {home.saved.length === 0 ? (
          <p className="text-ink-muted">Nothing saved yet. Use &ldquo;Save for later&rdquo; on any project to keep it here.</p>
        ) : (
          <CourseGrid courses={home.saved} hrefFor={exploreHref} audience="learner" />
        )}
      </section>

      {home.finished.length > 0 && (
        <section aria-labelledby="home-finished" className="flex flex-col gap-4">
          <h2 id="home-finished" className="text-2xl font-bold">
            Finished
          </h2>
          <ul className="flex flex-col gap-2">
            {home.finished.map((item) => (
              <li key={item.id}>
                <Link href={exploreHref(item.courseSlug)} className="link font-bold">
                  {item.courseTitle}
                </Link>
                {item.completedAt && <span className="text-ink-muted"> finished {formatDate(item.completedAt)}</span>}
              </li>
            ))}
          </ul>
          <p>
            <Link href="/portfolio" className="link">
              See your portfolio
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
