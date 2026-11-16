import { CalendarCheck, Clock, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { askToolApprovalAction, askUnlockAction } from "@/app/(learner)/explore/actions";
import { ReportControl } from "@/components/safety/ReportControl";
import { AskParentToUnlock, Badge, Callout, Card, CategoryBlock, DifficultyBadge, LastVerified, LinkButton, Markdown, ProgressBar, SubmitButton } from "@/components/ui";
import type { Course, LearnerCourse } from "@/content/schema";
import { formatMinutes } from "@/lib/dates";
import { toCourseOutline, type CourseOutline } from "@/lib/learning/outline";
import { coursePaths } from "@/lib/learning/paths";
import { ensureLearnerCourse } from "@/lib/learning/safe-course";
import { db } from "@/server/db";
import { resolveCourseMedia } from "@/server/services/course-page";
import type { EnrolmentView } from "@/server/services/enrolment";
import type { LearningGate } from "@/server/services/learning-gate";
import type { StartBlocker } from "@/server/services/start-gate";
import { SaveForLaterForm, StartCourseForm } from "./course-forms";
import { categoryName } from "./CourseCard";
import { EditableBlock, EditableText } from "./Editable";
import { stepTypeLabel } from "./player/steps";
import { ToolsYouNeed, type ToolsYouNeedProps } from "./ToolsYouNeed";
import type { PlayerMode } from "./types";
import { VideoPlayer } from "./VideoPlayer";

export type CourseViewMode =
  /** The public marketing page: no account, no progress. */
  | { kind: "public"; tasterHref?: string | null; signUpHref?: string; signInHref?: string }
  /** A signed-in learner, enrolled or not. Everything here comes from `getLearnerCoursePage`. */
  | {
      kind: "learner";
      learnerId: string;
      enrolment: EnrolmentView | null;
      gate: LearningGate;
      locked: boolean;
      saved: boolean;
      unlockAsked: { paid: boolean; pro: boolean };
      resumeKey: string | null;
      /** The player for this course, e.g. `/learn/my-course`. Opening it bare resumes at the right step. */
      playerBasePath: string;
    }
  /** Staff previewing a draft through the real page (spec 6.3). Nothing is recorded. */
  | (Extract<PlayerMode, { kind: "preview" }> & {
      playerBasePath: string;
      /** Whose "Tools you'll need" to show: staff (default, with unverified flags), or what a learner or parent would see. */
      toolsViewer?: ToolsYouNeedProps["viewer"];
    });

export type CourseViewProps = {
  /**
   * The course to show: a full `Course` (a draft, in preview), a `LearnerCourse`, or the outline
   * from `getLearnerCoursePage` / `getPublicCoursePage`. Whatever is passed, only the outline is
   * rendered: what it is, what you make, modules and timings, tools, rubric and watch-outs. No
   * step content, quiz or answer is ever read here.
   */
  content: Course | LearnerCourse | CourseOutline;
  /** `course.id`, or null for a draft that has no course row yet. */
  courseId: string | null;
  mode: CourseViewMode;
};

const isOutline = (content: CourseViewProps["content"]): content is CourseOutline => "stepCount" in content;

const TAG_WORDS: Record<string, string> = { ai: "AI", ui: "UI", ux: "UX", "3d": "3D", vr: "VR", ar: "AR", ml: "ML", iot: "IoT", html: "HTML", css: "CSS", api: "API", apis: "APIs", javascript: "JavaScript", seo: "SEO", cv: "CV" };
/** Skills and careers are stored as tags (`testing-ai`). Shown as words: "Testing AI". The stored value is what gets edited. */
function tagLabel(tag: string): string {
  const words = tag.split(/[-_\s]+/).filter(Boolean).map((word) => TAG_WORDS[word.toLowerCase()] ?? word);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-2xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TextList({ path, items }: { path: string; items: readonly string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-6">
      {items.map((item, index) => (
        <li key={index}>
          <EditableText path={`${path}[${index}]`} value={item} />
        </li>
      ))}
    </ul>
  );
}

/** One reason the learner cannot start yet, with what they can do about it. Never a price. */
function Blocker({ blocker, course, courseId, unlockAsked }: { blocker: StartBlocker; course: CourseOutline; courseId: string; unlockAsked: { paid: boolean; pro: boolean } }) {
  const hidden = (
    <>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="slug" value={course.slug} />
    </>
  );
  switch (blocker.code) {
    case "entitlement_required":
      return (
        <AskParentToUnlock onAsk={askUnlockAction} asked={unlockAsked.paid} itemName={course.title} headingLevel="h3">
          {hidden}
          <input type="hidden" name="kind" value="paid_course" />
        </AskParentToUnlock>
      );
    case "pro_approval_required":
      return (
        <AskParentToUnlock onAsk={askUnlockAction} asked={unlockAsked.pro} title="Pro projects need a parent's OK first" description={blocker.message} headingLevel="h3">
          {hidden}
          <input type="hidden" name="kind" value="pro_course" />
        </AskParentToUnlock>
      );
    case "tool_approval_required": {
      const waiting = blocker.status === "pending";
      return (
        <Callout tone="warning" title={blocker.policy === "parent_operated" ? `A parent needs to set up ${blocker.toolName}` : `${blocker.toolName} needs a parent's OK`}>
          <p>{blocker.message}</p>
          {waiting ? (
            <p className="font-bold">Request sent. We&apos;ve asked your parent, so there&apos;s nothing more to do for now.</p>
          ) : (
            <form action={askToolApprovalAction} className="flex flex-wrap items-center gap-3">
              {hidden}
              <input type="hidden" name="toolSlug" value={blocker.toolSlug} />
              <SubmitButton variant="secondary" pendingText="Sending your request…">
                {blocker.status === "none" ? `Ask a parent about ${blocker.toolName}` : `Ask again about ${blocker.toolName}`}
              </SubmitButton>
            </form>
          )}
        </Callout>
      );
    }
    default:
      return (
        <Callout tone="info" title={blocker.code === "not_allowed_now" ? "Not right now" : "This project is on hold"}>
          <p>{blocker.message}</p>
        </Callout>
      );
  }
}

function LearnerActions({ course, courseId, mode }: { course: CourseOutline; courseId: string; mode: Extract<CourseViewMode, { kind: "learner" }> }) {
  const { enrolment, gate } = mode;
  const open = gate.decision.blockers.length === 0 && gate.allowed.allowed;
  const blockers = gate.decision.blockers.filter((blocker) => blocker.code !== "course_unavailable" && blocker.code !== "age_restricted" && blocker.code !== "parent_blocked");
  const timeAlreadySaid = blockers.some((blocker) => blocker.code === "not_allowed_now");
  return (
    <section aria-label="Start or continue" className="flex flex-col gap-4">
      {enrolment && (
        <ProgressBar label="Your progress" value={enrolment.completedSteps} max={Math.max(enrolment.totalSteps, 1)} valueText={`${enrolment.completedSteps} of ${enrolment.totalSteps} steps done`} />
      )}
      {open &&
        (enrolment ? (
          <div>
            {/* The bare player address works out the exact step to resume at. */}
            <LinkButton size="lg" href={mode.playerBasePath}>
              {enrolment.status === "completed" ? "Look back through it" : "Continue"}
            </LinkButton>
          </div>
        ) : (
          <StartCourseForm slug={course.slug} />
        ))}
      {blockers.map((blocker, index) => (
        <Blocker key={`${blocker.code}-${index}`} blocker={blocker} course={course} courseId={courseId} unlockAsked={mode.unlockAsked} />
      ))}
      {!gate.allowed.allowed && !timeAlreadySaid && (
        <Callout tone="info" title="Not right now">
          <p>{gate.allowed.message}</p>
        </Callout>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SaveForLaterForm courseId={courseId} slug={course.slug} saved={mode.saved} />
        <ReportControl target={{ type: "course", id: courseId, courseId }} />
      </div>
    </section>
  );
}

function PublicActions({ course, mode }: { course: CourseOutline; mode: Extract<CourseViewMode, { kind: "public" }> }) {
  return (
    <section aria-label="Get started" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <LinkButton size="lg" href={mode.signUpHref ?? "/signup/parent"}>
          Get started
        </LinkButton>
        {mode.tasterHref && (
          <LinkButton size="lg" variant="secondary" href={mode.tasterHref}>
            Try the first few minutes
          </LinkButton>
        )}
      </div>
      <p className="text-ink-muted">
        {course.isFree ? "This project is free. " : "This project is part of the Family plan. "}
        Accounts are set up by a parent or carer.{" "}
        <Link href={mode.signInHref ?? "/signin"} className="link">
          Already have one? Sign in
        </Link>
        {!course.isFree && (
          <>
            {" "}
            or{" "}
            <Link href="/pricing" className="link">
              see the plans
            </Link>
          </>
        )}
        .
      </p>
    </section>
  );
}

/**
 * The course page body (spec 3.2): trailer, what you make, modules and timings, skills and
 * careers, Tools you'll need, a rubric preview, watch-outs, last-verified dates, and Start,
 * Continue or Save for later. One view for the public site, a signed-in learner and a staff
 * preview of a draft. A Server Component. It renders the page's one `<h1>` (the course title), so the
 * page around it must not add another.
 */
export async function CourseView({ content, courseId, mode }: CourseViewProps) {
  const course = isOutline(content) ? content : toCourseOutline(ensureLearnerCourse(content));
  const media = await resolveCourseMedia({ db }, [course.trailer.assetId, course.trailer.posterAssetId, course.trailer.captionsAssetId, ...course.trailerCompanionAssetIds], { transcripts: true });
  const trailer = media[course.trailer.assetId];
  const transcript = course.trailerCompanionAssetIds.map((id) => media[id]).find((asset) => asset?.kind === "transcript_md" && asset.text);
  const toolsViewer: ToolsYouNeedProps["viewer"] = mode.kind === "public" ? { kind: "public" } : mode.kind === "learner" ? { kind: "learner", learnerId: mode.learnerId } : (mode.toolsViewer ?? { kind: "staff" });

  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <CategoryBlock slug={course.category} name={categoryName(course.category)} size="sm" className="self-start" />
        <EditableText path="title" value={course.title} as="h1" className="text-3xl font-bold sm:text-4xl" />
        <EditableText path="tagline" value={course.tagline} as="p" className="max-w-measure text-ink-muted text-lg" />
        <div className="flex flex-wrap items-center gap-2">
          <DifficultyBadge level={course.difficulty} />
          <Badge icon={<Clock aria-hidden="true" className="size-4" strokeWidth={2.5} />}>
            About {formatMinutes(course.estimatedMinutes)}, in {course.sessions} {course.sessions === 1 ? "sitting" : "sittings"}
          </Badge>
          <Badge icon={<Users aria-hidden="true" className="size-4" strokeWidth={2.5} />}>Ages {course.minAge}+</Badge>
          {course.isFree && <Badge tone="accent">Free</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-ink-muted inline-flex items-center gap-1.5 text-sm">
            <ShieldCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
            Reviewed and signed off by the team
          </span>
          {course.lastVerifiedAt && <LastVerified date={course.lastVerifiedAt} />}
        </div>
      </header>

      {mode.kind === "learner" && courseId && <LearnerActions course={course} courseId={courseId} mode={mode} />}
      {mode.kind === "public" && <PublicActions course={course} mode={mode} />}
      {mode.kind === "preview" && (
        <section aria-label="Preview" className="flex flex-col gap-3">
          <Callout tone="warning" title="Staff preview">
            <p>This is the real course page for a draft. Nothing you do here is recorded, and no learner can see it.</p>
          </Callout>
          {course.firstStepKey && (
            <div>
              <LinkButton size="lg" href={`${mode.playerBasePath}/${course.firstStepKey}`}>
                Start (preview)
              </LinkButton>
            </div>
          )}
        </section>
      )}

      <Section id="course-trailer" title="Watch the trailer">
        <EditableBlock path="trailer" kind="media" label="Trailer video, poster and captions">
          <VideoPlayer
            title={`Trailer: ${course.title}`}
            src={trailer?.url ?? null}
            captionsSrc={media[course.trailer.captionsAssetId]?.url ?? null}
            posterSrc={media[course.trailer.posterAssetId]?.url ?? null}
            transcript={transcript?.text ? <Markdown topHeadingLevel={3}>{transcript.text}</Markdown> : null}
          />
        </EditableBlock>
      </Section>

      <Section id="course-make" title="What you'll make">
        <EditableText path="whatYouMake" value={course.whatYouMake} as="p" className="max-w-measure text-lg" multiline />
        <EditableText path="projectBrief.scenario" value={course.projectBrief.scenario} as="p" className="max-w-measure" multiline />
        <h3 className="text-xl font-bold">By the end you&apos;ll have</h3>
        <TextList path="projectBrief.deliverables" items={course.projectBrief.deliverables} />
        {course.projectBrief.constraints.length > 0 && (
          <>
            <h3 className="text-xl font-bold">The rules of the brief</h3>
            <TextList path="projectBrief.constraints" items={course.projectBrief.constraints} />
          </>
        )}
        {course.projectBrief.stretchGoals.length > 0 && (
          <>
            <h3 className="text-xl font-bold">If you want to push it further</h3>
            <TextList path="projectBrief.stretchGoals" items={course.projectBrief.stretchGoals} />
          </>
        )}
      </Section>

      <Section id="course-modules" title="What's inside">
        <p className="text-ink-muted">
          {course.modules.length} {course.modules.length === 1 ? "part" : "parts"}, {course.stepCount} steps. Go at your own pace: your place is saved.
        </p>
        <ol className="flex flex-col gap-4">
          {course.modules.map((mod, index) => {
            const path = coursePaths.module(mod.id);
            const minutes = mod.lessons.reduce((sum, lesson) => sum + lesson.estimatedMinutes, 0);
            return (
              <li key={mod.id}>
                <EditableBlock path={path} kind="module" label={mod.title}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-xl font-bold">
                        <span className="text-ink-muted">Part {index + 1}. </span>
                        <EditableText path={`${path}.title`} value={mod.title} />
                      </h3>
                      <span className="text-ink-muted text-sm font-bold">About {formatMinutes(minutes)}</span>
                    </div>
                    <EditableText path={`${path}.summary`} value={mod.summary} as="p" multiline />
                    <ul className="flex flex-col gap-2">
                      {mod.lessons.map((lesson) => {
                        const lessonPath = coursePaths.lesson(mod.id, lesson.id);
                        return (
                          <li key={lesson.id}>
                            <EditableBlock path={lessonPath} kind="lesson" label={lesson.title}>
                              <details className="rounded-control border-line border-2">
                                <summary className="hover:bg-tint flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 font-bold -outline-offset-4">
                                  <EditableText path={`${lessonPath}.title`} value={lesson.title} />
                                  <span className="text-ink-muted text-sm">
                                    {lesson.steps.length} {lesson.steps.length === 1 ? "step" : "steps"}, about {formatMinutes(lesson.estimatedMinutes)}
                                  </span>
                                </summary>
                                <ol className="border-line flex flex-col gap-1 border-t-2 px-3 py-2">
                                  {lesson.steps.map((step) => (
                                    <li key={step.id} className="flex flex-wrap items-baseline justify-between gap-2">
                                      <span>
                                        <span className="text-ink-muted text-sm font-bold">{stepTypeLabel(step.type)}: </span>
                                        <EditableText path={`${coursePaths.step(mod.id, lesson.id, step.id)}.title`} value={step.title} />
                                      </span>
                                      <span className="text-ink-muted text-sm">{formatMinutes(step.estimatedMinutes)}</span>
                                    </li>
                                  ))}
                                </ol>
                              </details>
                            </EditableBlock>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </EditableBlock>
              </li>
            );
          })}
        </ol>
      </Section>

      {(course.skills.length > 0 || course.careers.length > 0) && (
        <Section id="course-skills" title="Skills and where they lead">
          {course.skills.length > 0 && (
            <>
              <h3 className="text-xl font-bold">You&apos;ll practise</h3>
              <ul className="flex flex-wrap gap-2">
                {course.skills.map((skill, index) => (
                  <li key={index}>
                    <Badge>
                      <EditableText path={`skills[${index}]`} value={skill}>
                        {tagLabel(skill)}
                      </EditableText>
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
          {course.careers.length > 0 && (
            <>
              <h3 className="text-xl font-bold">Jobs that use this</h3>
              <ul className="flex flex-wrap gap-2">
                {course.careers.map((career, index) => (
                  <li key={index}>
                    <Badge tone="info">
                      <EditableText path={`careers[${index}]`} value={career}>
                        {tagLabel(career)}
                      </EditableText>
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      <ToolsYouNeed courseId={courseId} courseSlug={course.slug} toolRequirements={course.toolRequirements} setupGuides={course.setupGuides} viewer={toolsViewer} />

      <Section id="course-rubric" title="How you'll check your own work">
        <p className="text-ink-muted">Before you hand in, you rate your project against these. &ldquo;Not yet&rdquo; is an honest answer and never stops you handing in.</p>
        <ul className="flex flex-col gap-3">
          {course.rubric.criteria.map((criterion) => {
            const path = coursePaths.criterion(criterion.id);
            return (
              <li key={criterion.id}>
                <EditableBlock path={path} kind="rubric_criterion" label={criterion.name}>
                  <Card className="flex flex-col gap-2">
                    <EditableText path={`${path}.name`} value={criterion.name} as="h3" className="text-xl font-bold" />
                    <EditableText path={`${path}.description`} value={criterion.description} as="p" multiline />
                    <dl className="grid gap-2 sm:grid-cols-3">
                      {criterion.levels.map((level, index) => (
                        <div key={level.label} className="rounded-control bg-tint p-3">
                          <dt className="font-bold">{level.label}</dt>
                          <dd>
                            <EditableText path={`${path}.levels[${index}].descriptor`} value={level.descriptor} multiline />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </Card>
                </EditableBlock>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="course-watch-outs" title="Things to watch out for">
        {course.watchOut && (
          <Callout tone="warning" title="Before you start">
            <EditableText path="watchOut.note" value={course.watchOut.note} as="p" multiline />
          </Callout>
        )}
        <Callout tone="info" title="Using AI honestly">
          <EditableText path="ethicsNote" value={course.ethicsNote} as="p" multiline />
        </Callout>
      </Section>

      <footer className="border-line text-ink-muted flex flex-col gap-1 border-t-2 pt-4 text-sm">
        <p className="inline-flex items-center gap-1.5">
          <CalendarCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
          Tools change. We re-check every course and its setup guides, and show the dates here.
        </p>
        {course.lastVerifiedAt && <LastVerified date={course.lastVerifiedAt} prefix="Course last checked" />}
        {course.guidesLastVerifiedAt && <LastVerified date={course.guidesLastVerifiedAt} prefix="Setup guides last checked" />}
        <p>Version {course.version}</p>
      </footer>
    </article>
  );
}
