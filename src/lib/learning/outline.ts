/**
 * The course page's view of a course: what it is, what you make, how it is laid out and how long
 * it takes. No step bodies, tasks, hints, quiz questions or guide text: the outline is what the
 * public page, a locked course and the API may show.
 */
import type { Course, LearnerCourse, StepType } from "@/content/schema";

export type OutlineStep = { id: string; type: StepType; title: string; estimatedMinutes: number };
export type OutlineLesson = { id: string; title: string; estimatedMinutes: number; steps: OutlineStep[] };
export type OutlineModule = { id: string; title: string; summary: string; lessons: OutlineLesson[] };

export type CourseOutline = Pick<
  LearnerCourse,
  | "slug"
  | "title"
  | "tagline"
  | "category"
  | "interests"
  | "difficulty"
  | "pathways"
  | "minAge"
  | "estimatedMinutes"
  | "sessions"
  | "isFree"
  | "careers"
  | "skills"
  | "trailer"
  | "whatYouMake"
  | "ethicsNote"
  | "watchOut"
  | "toolRequirements"
  | "projectBrief"
  | "rubric"
  | "version"
  | "lastVerifiedAt"
  | "guidesLastVerifiedAt"
> & {
  setupGuides: { id: string; toolSlug: string; title: string; lastVerifiedAt: string }[];
  modules: OutlineModule[];
  stepCount: number;
};

type AnyCourse = Course | LearnerCourse | CourseOutline;

/**
 * Builds the outline by copying named fields, so anything not listed here (answers, `coachContext`,
 * editor notes, a field added to the model later) is left behind by default.
 */
export function toCourseOutline(course: AnyCourse): CourseOutline {
  const modules: OutlineModule[] = course.modules.map((mod) => ({
    id: mod.id,
    title: mod.title,
    summary: mod.summary,
    lessons: mod.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      estimatedMinutes: lesson.estimatedMinutes,
      steps: lesson.steps.map((step) => ({ id: step.id, type: step.type, title: step.title, estimatedMinutes: step.estimatedMinutes })),
    })),
  }));
  return {
    slug: course.slug,
    title: course.title,
    tagline: course.tagline,
    category: course.category,
    interests: [...course.interests],
    difficulty: course.difficulty,
    pathways: [...course.pathways],
    minAge: course.minAge,
    estimatedMinutes: course.estimatedMinutes,
    sessions: course.sessions,
    isFree: course.isFree,
    careers: [...course.careers],
    skills: [...course.skills],
    trailer: { ...course.trailer },
    whatYouMake: course.whatYouMake,
    ethicsNote: course.ethicsNote,
    watchOut: course.watchOut ? { ...course.watchOut } : undefined,
    toolRequirements: course.toolRequirements.map((tool) => ({ ...tool })),
    setupGuides: course.setupGuides.map((guide) => ({ id: guide.id, toolSlug: guide.toolSlug, title: guide.title, lastVerifiedAt: guide.lastVerifiedAt })),
    projectBrief: {
      scenario: course.projectBrief.scenario,
      deliverables: [...course.projectBrief.deliverables],
      constraints: [...course.projectBrief.constraints],
      stretchGoals: [...course.projectBrief.stretchGoals],
      artefactTypes: [...course.projectBrief.artefactTypes],
      evidence: [...course.projectBrief.evidence],
    },
    rubric: { criteria: course.rubric.criteria.map((criterion) => ({ ...criterion, levels: criterion.levels.map((level) => ({ ...level })) })) },
    version: course.version,
    lastVerifiedAt: course.lastVerifiedAt,
    guidesLastVerifiedAt: course.guidesLastVerifiedAt,
    modules,
    stepCount: modules.reduce((total, mod) => total + mod.lessons.reduce((sum, lesson) => sum + lesson.steps.length, 0), 0),
  };
}
