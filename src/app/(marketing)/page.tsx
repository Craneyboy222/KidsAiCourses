import { ArrowRight, Hammer, ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CourseGrid } from "@/components/course";
import { Callout, Card, LinkButton, Markdown } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";
import { fillBrand } from "@/lib/marketing/brand-fill";
import { publicPageMetadata } from "@/lib/marketing/metadata";
import { homeLinkFor } from "@/lib/marketing/site";
import { getCtx } from "@/server/context";
import { tDefault, tMany } from "@/server/copy";
import { getHomeCourses } from "@/server/services/marketing";
import { getSitePage } from "@/server/services/pages";
import { isSignupOpen } from "@/server/settings/launch-readiness";

export function generateMetadata(): Metadata {
  return publicPageMetadata({
    title: `${BRAND_NAME}: learn today's AI tools by making real projects`,
    description: tDefault("marketing.home.lede"),
    path: "/",
    absoluteTitle: true,
  });
}

const COPY_KEYS = [
  "marketing.home.eyebrow",
  "marketing.home.title",
  "marketing.home.lede",
  "marketing.home.cta.parent",
  "marketing.home.cta.teen",
  "marketing.home.cta.teen_note",
  "marketing.home.signed_in.learner",
  "marketing.home.signed_in.parent",
  "marketing.home.signed_in.staff",
  "marketing.home.what.title",
  "marketing.home.what.body",
  "marketing.home.who.title",
  "marketing.home.who.body",
  "marketing.home.safe.title",
  "marketing.home.safe.body",
  "marketing.home.courses.title",
  "marketing.home.courses.lede",
  "marketing.home.courses.empty",
  "signup.closed",
] as const;

/**
 * The home page: what this is, who it is for and how it is kept safe, on one screen, then real
 * courses from the catalogue. Honest claims only (no testimonials, no numbers, no "trusted by"),
 * and no prices: those are on the pricing page.
 *
 * The page is the same for everyone and never redirects. A signed-in learner or parent gets a
 * link to their own home where a visitor gets the sign-up calls to action.
 */
export default async function HomePage() {
  const ctx = await getCtx();
  const home = homeLinkFor(ctx.actor);
  const [copy, courses, expectations, signupOpen] = await Promise.all([
    tMany(ctx, COPY_KEYS),
    getHomeCourses(ctx),
    getSitePage(ctx, "marketing", "home"),
    home ? Promise.resolve(true) : isSignupOpen(ctx).catch(() => true),
  ]);
  const actorType = ctx.actor.type;
  const signedInLine = actorType === "learner" ? copy["marketing.home.signed_in.learner"] : actorType === "parent" ? copy["marketing.home.signed_in.parent"] : copy["marketing.home.signed_in.staff"];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-8 sm:py-12">
      <section aria-labelledby="home-title" className="flex flex-col gap-6">
        <div className="flex max-w-3xl flex-col gap-4">
          <p className="text-ink-muted font-bold">{copy["marketing.home.eyebrow"]}</p>
          <h1 id="home-title" className="text-4xl font-bold">
            {copy["marketing.home.title"]}
          </h1>
          <p className="text-xl">{copy["marketing.home.lede"]}</p>
        </div>

        {home ? (
          <div className="flex flex-col gap-3" data-testid="home-signed-in">
            <p className="font-bold">{signedInLine}</p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={home.href} size="lg" iconEnd={<ArrowRight aria-hidden="true" className="size-5" strokeWidth={2.5} />}>
                {home.label}
              </LinkButton>
              {actorType === "learner" && (
                <LinkButton href="/explore" size="lg" variant="secondary">
                  Explore courses
                </LinkButton>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="home-calls-to-action">
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/signup/parent" size="lg">
                {copy["marketing.home.cta.parent"]}
              </LinkButton>
              <LinkButton href="/signup/teen" size="lg" variant="secondary">
                {copy["marketing.home.cta.teen"]}
              </LinkButton>
            </div>
            <p className="text-ink-muted max-w-measure">{copy["marketing.home.cta.teen_note"]}</p>
            {!signupOpen && (
              <Callout tone="info" className="max-w-measure">
                <p>{copy["signup.closed"]}</p>
              </Callout>
            )}
          </div>
        )}

        <ul className="grid gap-4 md:grid-cols-3">
          <Pillar icon={<Hammer aria-hidden="true" className="size-6" strokeWidth={2.25} />} tone="bg-cat-1" title={copy["marketing.home.what.title"]} body={copy["marketing.home.what.body"]} href="/how-it-works" linkLabel="How it works" />
          <Pillar icon={<Users aria-hidden="true" className="size-6" strokeWidth={2.25} />} tone="bg-cat-4" title={copy["marketing.home.who.title"]} body={copy["marketing.home.who.body"]} href="/parents" linkLabel="Guide for parents" />
          <Pillar icon={<ShieldCheck aria-hidden="true" className="size-6" strokeWidth={2.25} />} tone="bg-cat-3" title={copy["marketing.home.safe.title"]} body={copy["marketing.home.safe.body"]} href="/safety" linkLabel="How we keep it safe" />
        </ul>
      </section>

      <section aria-labelledby="home-courses" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="home-courses" className="text-3xl font-bold">
              {copy["marketing.home.courses.title"]}
            </h2>
            <p className="text-ink-muted">{copy["marketing.home.courses.lede"]}</p>
          </div>
          <LinkButton href={actorType === "learner" ? "/explore" : "/courses"} variant="secondary">
            See all courses
          </LinkButton>
        </div>
        {courses.length > 0 ? (
          <CourseGrid courses={courses} hrefFor={(slug) => `/courses/${slug}`} audience="public" headingLevel="h3" />
        ) : actorType === "learner" ? (
          <p className="max-w-measure">Your own catalogue shows the courses that are right for your age and your family&apos;s settings.</p>
        ) : (
          <p className="max-w-measure">{copy["marketing.home.courses.empty"]}</p>
        )}
      </section>

      {expectations && (
        <Card as="section" variant="tint" padding="lg" aria-label={fillBrand(expectations.title)}>
          <Markdown>{fillBrand(expectations.body)}</Markdown>
        </Card>
      )}
    </div>
  );
}

function Pillar({ icon, tone, title, body, href, linkLabel }: { icon: ReactNode; tone: string; title: string; body: string; href: string; linkLabel: string }) {
  return (
    <Card as="li" className="flex flex-col gap-3">
      <span className={`border-ink text-on-cat flex size-11 items-center justify-center rounded-full border-2 ${tone}`}>{icon}</span>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="flex-1">{body}</p>
      <LinkButton href={href} variant="ghost" size="sm" className="self-start" iconEnd={<ArrowRight aria-hidden="true" className="size-4" strokeWidth={2.5} />}>
        {linkLabel}
      </LinkButton>
    </Card>
  );
}
