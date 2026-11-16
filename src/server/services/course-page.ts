import { and, eq } from "drizzle-orm";
import { toLearnerCourse, type Course, type LearnerCourse } from "@/content/schema";
import { toCourseOutline, type CourseOutline } from "@/lib/learning/outline";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, enrolment, unlockRequest, wishlist } from "@/server/db";
import { logWarn } from "@/server/log";
import { getStorage } from "@/server/storage";
import { getAssetsByKeys } from "./assets";
import { getPublishedCourseBySlug, loadVersionContent } from "./course-store";
import { readEnrolmentView, type EnrolmentView } from "./enrolment";
import { gateHidden, getLearningGate, type LearningGate } from "./learning-gate";
import { getToolsBySlugs, toolViewForLearners } from "./tools";

// ───────────────────────────── Media ─────────────────────────────

export type MediaAsset = {
  id: string;
  kind: "video" | "image" | "audio" | "captions_vtt" | "transcript_md" | "template_zip" | "dataset_csv" | "font" | "guide_screenshot";
  /** A short-lived signed link, or null when the file has not been uploaded yet. */
  url: string | null;
  altText: string | null;
  durationSec: number | null;
  attribution: string | null;
  /** The transcript itself (Markdown), for `transcript_md` assets when asked for. */
  text: string | null;
};

/** Asset id → what the page needs to show it. Ids with no asset record are absent. */
export type CourseMedia = Record<string, MediaAsset>;

const MEDIA_LINK_SECONDS = 3600;
const MAX_TRANSCRIPT_BYTES = 200_000;

/**
 * Turns asset ids into signed links. Course media lives in the `public` bucket, but nothing is
 * world-readable: every file is reached through a link that runs out. A file that is not in
 * storage yet (seed content ships with placeholders) gets `url: null`, and the page says so
 * instead of showing a broken player.
 */
export async function resolveCourseMedia(ctx: Pick<Ctx, "db">, assetIds: readonly string[], options: { transcripts?: boolean } = {}): Promise<CourseMedia> {
  const rows = await getAssetsByKeys(ctx, assetIds);
  const storage = getStorage("public");
  const media: CourseMedia = {};
  await Promise.all(
    [...rows.values()].map(async (row) => {
      let url: string | null = null;
      let text: string | null = null;
      try {
        if (await storage.exists(row.storageKey)) {
          if (row.kind === "transcript_md") {
            if (options.transcripts) {
              const file = await storage.get(row.storageKey);
              if (file && file.size <= MAX_TRANSCRIPT_BYTES) text = file.body.toString("utf8");
            }
          } else {
            const download = row.kind === "template_zip" || row.kind === "dataset_csv";
            url = await storage.signedDownloadUrl(row.storageKey, {
              expiresInSec: MEDIA_LINK_SECONDS,
              downloadName: download ? row.storageKey.split("/").pop() : undefined,
            });
          }
        }
      } catch (error) {
        logWarn("course_media.unavailable", { assetKey: row.key, error: error instanceof Error ? error.message : String(error) });
      }
      media[row.key] = { id: row.key, kind: row.kind, url, altText: row.altText, durationSec: row.durationSec, attribution: row.attribution, text };
    }),
  );
  return media;
}

/** A video can be played only when both the file and its captions are in storage (spec 3.2: captions on every video). */
export function isVideoPlayable(media: CourseMedia): boolean {
  const assets = Object.values(media);
  return assets.some((asset) => asset.kind === "video" && asset.url !== null) && assets.some((asset) => asset.kind === "captions_vtt" && asset.url !== null);
}

// ───────────────────────────── Tools ─────────────────────────────

/** What a step needs to know about a tool, read from the Register at request time. Never stored in a course. */
export type StepTool = {
  slug: string;
  name: string;
  /** The official link, only when it passes the tool's own allow-list. */
  officialUrl: string | null;
  /** False when the Register does not currently allow learners to open this tool: no link is rendered. */
  linkAllowed: boolean;
  /** `parent_operated`: the learner sees "Ask a parent to set this up", never "create your own account". */
  parentMustSetUp: boolean;
};

export async function stepToolsFor(ctx: Pick<Ctx, "db">, slugs: readonly string[]): Promise<Record<string, StepTool>> {
  const rows = await getToolsBySlugs(ctx, slugs);
  const tools: Record<string, StepTool> = {};
  for (const [slug, row] of rows) {
    const view = toolViewForLearners(row);
    tools[slug] = {
      slug,
      name: row.name,
      officialUrl: view?.officialUrl ?? null,
      linkAllowed: view !== null && view.officialUrl !== null,
      parentMustSetUp: view?.parentMustSetUp ?? false,
    };
  }
  return tools;
}

// ───────────────────────────── Course page ─────────────────────────────

export type PublicCoursePage = { courseId: string; course: CourseOutline; firstTasterStepKey: string | null };

/** The public course page. An outline only: titles and timings, no step content. */
export async function getPublicCoursePage(ctx: Pick<Ctx, "db">, slug: string): Promise<PublicCoursePage | null> {
  const published = await getPublishedCourseBySlug(ctx, slug);
  if (!published) return null;
  const safe = toLearnerCourse(published.content);
  return { courseId: published.course.id, course: toCourseOutline(safe), firstTasterStepKey: tasterSteps(safe)[0]?.id ?? null };
}

/** Step types a taster may show: things to watch or read. Never a tool, a quiz or anything that records work. */
const TASTER_TYPES = new Set(["video", "read"]);

/**
 * The public taster: the opening video and reading steps of the FIRST lesson, up to the first step
 * that needs an account (a setup guide, a tool task, a quiz…). Enough to see what the course is
 * like; nothing that needs a tool or records anything.
 */
export function tasterSteps(safe: LearnerCourse): LearnerCourse["modules"][number]["lessons"][number]["steps"] {
  const lesson = safe.modules[0]?.lessons[0];
  if (!lesson) return [];
  const steps = [];
  for (const step of lesson.steps) {
    if (!TASTER_TYPES.has(step.type)) break;
    steps.push(step);
  }
  return steps;
}

export async function getPublicTaster(ctx: Pick<Ctx, "db">, slug: string): Promise<{ courseId: string; course: CourseOutline; steps: ReturnType<typeof tasterSteps>; moduleId: string; lessonId: string } | null> {
  const published = await getPublishedCourseBySlug(ctx, slug);
  if (!published) return null;
  const safe = toLearnerCourse(published.content);
  const steps = tasterSteps(safe);
  const mod = safe.modules[0];
  const lesson = mod?.lessons[0];
  if (steps.length === 0 || !mod || !lesson) return null;
  return { courseId: published.course.id, course: toCourseOutline(safe), steps, moduleId: mod.id, lessonId: lesson.id };
}

export type LearnerCoursePage =
  | { kind: "not_found" }
  /** Started, then taken down: a clear notice and nothing else. */
  | { kind: "taken_down"; courseTitle: string }
  | {
      kind: "ok";
      courseId: string;
      /** An outline: no step bodies, tasks, hints, quizzes or guide text. A locked course exposes nothing more than this. */
      course: CourseOutline;
      enrolment: EnrolmentView | null;
      gate: LearningGate;
      /** Paid course, and the family's plan does not cover it. Shown with "Ask a parent to unlock" — never a price. */
      locked: boolean;
      saved: boolean;
      /** A request to a parent is already waiting. */
      unlockAsked: { paid: boolean; pro: boolean };
      /** Where "Continue" goes. */
      resumeKey: string | null;
    };

/**
 * The signed-in course page. The age gate and a parent's block answer "not found", so a direct
 * link behaves exactly like a course that does not exist (spec 3.2).
 */
export async function getLearnerCoursePage(ctx: Ctx, learnerId: string, slug: string): Promise<LearnerCoursePage> {
  assertCan(ctx.actor, "learner.catalogue.read", { learnerId });
  const [row] = await ctx.db.select({ id: course.id, title: course.title }).from(course).where(eq(course.slug, slug)).limit(1);
  if (!row) return { kind: "not_found" };

  const gate = await getLearningGate(ctx, learnerId, row.id);
  if (gateHidden(gate)) return { kind: "not_found" };

  const [enrolled] = await ctx.db.select({ id: enrolment.id, courseVersionId: enrolment.courseVersionId }).from(enrolment).where(and(eq(enrolment.learnerId, learnerId), eq(enrolment.courseId, row.id))).limit(1);
  const published = await getPublishedCourseBySlug(ctx, slug);
  if (!published) return enrolled ? { kind: "taken_down", courseTitle: row.title } : { kind: "not_found" };

  // Someone who has started sees the version they are pinned to; everyone else sees the live one.
  let content: Course = published.content;
  if (enrolled && enrolled.courseVersionId !== published.version.id) content = await loadVersionContent(ctx, enrolled.courseVersionId);
  const view = enrolled ? await readEnrolmentView(ctx.db, enrolled.id) : null;

  const [savedRow] = await ctx.db.select({ id: wishlist.id }).from(wishlist).where(and(eq(wishlist.learnerId, learnerId), eq(wishlist.courseId, row.id))).limit(1);
  const pending = await ctx.db
    .select({ kind: unlockRequest.kind })
    .from(unlockRequest)
    .where(and(eq(unlockRequest.learnerId, learnerId), eq(unlockRequest.courseId, row.id), eq(unlockRequest.status, "pending")));

  return {
    kind: "ok",
    courseId: row.id,
    course: toCourseOutline(toLearnerCourse(content)),
    enrolment: view,
    gate,
    locked: gate.decision.blockers.some((blocker) => blocker.code === "entitlement_required"),
    saved: savedRow !== undefined,
    unlockAsked: { paid: pending.some((item) => item.kind === "paid_course"), pro: pending.some((item) => item.kind === "pro_course") },
    resumeKey: view?.currentStepKey ?? null,
  };
}
