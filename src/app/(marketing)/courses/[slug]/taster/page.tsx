import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { VideoPlayer } from "@/components/course";
import { Breadcrumbs, Callout, LinkButton, Markdown } from "@/components/ui";
import { formatMinutes } from "@/lib/dates";
import { getCtx } from "@/server/context";
import { getPublicTaster, resolveCourseMedia } from "@/server/services/course-page";

type Params = Promise<{ slug: string }>;

const validSlug = (slug: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 120;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await getCtx();
  const taster = validSlug(slug) && ctx.actor.type !== "learner" ? await getPublicTaster(ctx, slug) : null;
  if (!taster) return { title: "Taster not found", robots: { index: false, follow: false } };
  return {
    title: `Taster: ${taster.course.title}`,
    description: `Try the first few minutes of ${taster.course.title}. No account needed.`,
    alternates: { canonical: `/courses/${taster.course.slug}/taster` },
  };
}

/**
 * A taster: the opening video and reading of a course, for anyone to try without an account.
 *
 * Deliberately small. It shows only the watch-and-read steps at the very start of the first
 * lesson, and stops at the first step that needs a tool, an account or an answer. Nothing is
 * recorded: no progress, no time, no cookies beyond the strictly necessary ones. There is no
 * Coach, no upload and no link out to a tool here.
 *
 * No `<main>` here: the marketing layout (owned by the marketing slice) provides the page frame.
 */
export default async function TasterPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const ctx = await getCtx();
  if (ctx.actor.type === "learner") redirect(`/explore/${slug}`);
  const taster = await getPublicTaster(ctx, slug);
  if (!taster) notFound();

  const media = await resolveCourseMedia(
    ctx,
    taster.steps.flatMap((step) => step.assetIds ?? []),
    { transcripts: true },
  );

  return (
    <div className="max-w-measure mx-auto flex w-full flex-col gap-8 px-4 py-8">
      <Breadcrumbs items={[{ label: "Courses", href: "/courses" }, { label: taster.course.title, href: `/courses/${taster.course.slug}` }, { label: "Taster" }]} />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold sm:text-4xl">Taster: {taster.course.title}</h1>
        <p className="text-ink-muted text-lg">The first few minutes, exactly as learners see them. Nothing you do here is saved.</p>
      </header>

      {taster.steps.map((step) => {
        const assets = (step.assetIds ?? []).map((id) => media[id]).filter((asset) => asset !== undefined);
        const video = assets.find((asset) => asset.kind === "video");
        const captions = assets.find((asset) => asset.kind === "captions_vtt");
        const transcript = assets.find((asset) => asset.kind === "transcript_md");
        return (
          <section key={step.id} aria-labelledby={`taster-${step.id}`} className="flex flex-col gap-4">
            <h2 id={`taster-${step.id}`} className="text-2xl font-bold">
              {step.title}
            </h2>
            <p className="text-ink-muted text-sm font-bold">About {formatMinutes(step.estimatedMinutes)}</p>
            {step.type === "video" && (
              <VideoPlayer title={step.title} src={video?.url ?? null} captionsSrc={captions?.url ?? null} posterSrc={null} transcript={transcript?.text ? <Markdown topHeadingLevel={3}>{transcript.text}</Markdown> : null} />
            )}
            {step.body && <Markdown topHeadingLevel={3}>{step.body}</Markdown>}
          </section>
        );
      })}

      <Callout
        tone="info"
        title="That's the taster"
        actions={
          <>
            <LinkButton href="/signup/parent">Get started</LinkButton>
            <LinkButton href={`/courses/${taster.course.slug}`} variant="secondary">
              Back to the course
            </LinkButton>
          </>
        }
      >
        <p>The rest of the project is done in a real tool, with step-by-step guides, hints and an AI coach that nudges but never does the work. Accounts are set up by a parent or carer.</p>
      </Callout>
    </div>
  );
}
