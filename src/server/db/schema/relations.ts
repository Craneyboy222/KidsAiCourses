import { relations } from "drizzle-orm";
import { aiMessage, tutorConversation } from "./ai";
import { page, pageVersion, plan, subscription } from "./billing-cms";
import {
  course,
  courseModule,
  courseTool,
  courseVersion,
  lesson,
  quiz,
  quizQuestion,
  rubricCriterion,
  step,
  toolGuide,
  toolGuideStep,
} from "./content";
import {
  account,
  family,
  familyMember,
  learnerProfile,
  parentControl,
  session,
  staffRole,
  user,
} from "./identity";
import {
  artefact,
  certificate,
  enrolment,
  project,
  projectVersion,
  quizAttempt,
  stepProgress,
} from "./learning";
import { moderationItem, report, safeguardingAccessLog, safeguardingCase } from "./safety";
import {
  radarCandidate,
  radarItem,
  radarMention,
  radarSource,
  reviewDecision,
  reviewTask,
  tool,
  toolApproval,
  toolChangeEvent,
} from "./tools-radar";

/**
 * Relations for Drizzle's relational queries (`db.query.course.findFirst({ with: … })`).
 * They cover the graphs that are read together; everything else is joined explicitly.
 * Where two tables are linked more than once, both sides carry a `relationName`.
 */

// ── Identity ────────────────────────────────────────────────────────────────
export const userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  staffRoles: many(staffRole),
  learnerProfile: one(learnerProfile),
  familyMember: one(familyMember),
  parentControl: one(parentControl),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
export const staffRoleRelations = relations(staffRole, ({ one }) => ({
  user: one(user, { fields: [staffRole.userId], references: [user.id] }),
}));
export const learnerProfileRelations = relations(learnerProfile, ({ one }) => ({
  user: one(user, { fields: [learnerProfile.userId], references: [user.id] }),
}));
export const familyRelations = relations(family, ({ one, many }) => ({
  owner: one(user, { fields: [family.ownerUserId], references: [user.id] }),
  members: many(familyMember),
  subscriptions: many(subscription),
}));
export const familyMemberRelations = relations(familyMember, ({ one }) => ({
  family: one(family, { fields: [familyMember.familyId], references: [family.id] }),
  user: one(user, { fields: [familyMember.userId], references: [user.id] }),
}));
export const parentControlRelations = relations(parentControl, ({ one }) => ({
  learner: one(user, { fields: [parentControl.learnerId], references: [user.id] }),
}));

// ── Content ─────────────────────────────────────────────────────────────────
export const courseRelations = relations(course, ({ one, many }) => ({
  versions: many(courseVersion, { relationName: "course_versions" }),
  publishedVersion: one(courseVersion, {
    fields: [course.publishedVersionId],
    references: [courseVersion.id],
    relationName: "course_published_version",
  }),
  workingVersion: one(courseVersion, {
    fields: [course.workingVersionId],
    references: [courseVersion.id],
    relationName: "course_working_version",
  }),
  enrolments: many(enrolment),
}));
export const courseVersionRelations = relations(courseVersion, ({ one, many }) => ({
  course: one(course, {
    fields: [courseVersion.courseId],
    references: [course.id],
    relationName: "course_versions",
  }),
  modules: many(courseModule),
  lessons: many(lesson),
  steps: many(step),
  quizzes: many(quiz),
  rubricCriteria: many(rubricCriterion),
  courseTools: many(courseTool),
  toolGuides: many(toolGuide),
  reviewDecisions: many(reviewDecision),
}));
export const courseModuleRelations = relations(courseModule, ({ one, many }) => ({
  courseVersion: one(courseVersion, {
    fields: [courseModule.courseVersionId],
    references: [courseVersion.id],
  }),
  lessons: many(lesson),
}));
export const lessonRelations = relations(lesson, ({ one, many }) => ({
  courseVersion: one(courseVersion, { fields: [lesson.courseVersionId], references: [courseVersion.id] }),
  module: one(courseModule, { fields: [lesson.moduleId], references: [courseModule.id] }),
  steps: many(step),
}));
export const stepRelations = relations(step, ({ one }) => ({
  courseVersion: one(courseVersion, { fields: [step.courseVersionId], references: [courseVersion.id] }),
  lesson: one(lesson, { fields: [step.lessonId], references: [lesson.id] }),
}));
export const quizRelations = relations(quiz, ({ one, many }) => ({
  courseVersion: one(courseVersion, { fields: [quiz.courseVersionId], references: [courseVersion.id] }),
  questions: many(quizQuestion),
}));
export const quizQuestionRelations = relations(quizQuestion, ({ one }) => ({
  quiz: one(quiz, { fields: [quizQuestion.quizId], references: [quiz.id] }),
}));
export const rubricCriterionRelations = relations(rubricCriterion, ({ one }) => ({
  courseVersion: one(courseVersion, {
    fields: [rubricCriterion.courseVersionId],
    references: [courseVersion.id],
  }),
}));
export const courseToolRelations = relations(courseTool, ({ one }) => ({
  courseVersion: one(courseVersion, { fields: [courseTool.courseVersionId], references: [courseVersion.id] }),
  tool: one(tool, { fields: [courseTool.toolId], references: [tool.id], relationName: "course_tool_tool" }),
  fallbackTool: one(tool, {
    fields: [courseTool.fallbackToolId],
    references: [tool.id],
    relationName: "course_tool_fallback",
  }),
}));
export const toolGuideRelations = relations(toolGuide, ({ one, many }) => ({
  courseVersion: one(courseVersion, { fields: [toolGuide.courseVersionId], references: [courseVersion.id] }),
  tool: one(tool, { fields: [toolGuide.toolId], references: [tool.id] }),
  steps: many(toolGuideStep),
}));
export const toolGuideStepRelations = relations(toolGuideStep, ({ one }) => ({
  guide: one(toolGuide, { fields: [toolGuideStep.toolGuideId], references: [toolGuide.id] }),
}));

// ── Tools, Radar and review ─────────────────────────────────────────────────
export const toolRelations = relations(tool, ({ many }) => ({
  courseTools: many(courseTool, { relationName: "course_tool_tool" }),
  guides: many(toolGuide),
  changeEvents: many(toolChangeEvent),
  approvals: many(toolApproval),
}));
export const toolChangeEventRelations = relations(toolChangeEvent, ({ one }) => ({
  tool: one(tool, { fields: [toolChangeEvent.toolId], references: [tool.id] }),
}));
export const toolApprovalRelations = relations(toolApproval, ({ one }) => ({
  tool: one(tool, { fields: [toolApproval.toolId], references: [tool.id] }),
  course: one(course, { fields: [toolApproval.courseId], references: [course.id] }),
  learner: one(user, { fields: [toolApproval.learnerId], references: [user.id] }),
}));
export const radarSourceRelations = relations(radarSource, ({ many }) => ({
  items: many(radarItem),
}));
export const radarItemRelations = relations(radarItem, ({ one, many }) => ({
  source: one(radarSource, { fields: [radarItem.sourceId], references: [radarSource.id] }),
  mentions: many(radarMention),
}));
export const radarCandidateRelations = relations(radarCandidate, ({ one, many }) => ({
  tool: one(tool, { fields: [radarCandidate.toolId], references: [tool.id] }),
  mentions: many(radarMention),
}));
export const radarMentionRelations = relations(radarMention, ({ one }) => ({
  candidate: one(radarCandidate, { fields: [radarMention.candidateId], references: [radarCandidate.id] }),
  item: one(radarItem, { fields: [radarMention.itemId], references: [radarItem.id] }),
}));
export const reviewTaskRelations = relations(reviewTask, ({ one, many }) => ({
  course: one(course, { fields: [reviewTask.courseId], references: [course.id] }),
  courseVersion: one(courseVersion, { fields: [reviewTask.courseVersionId], references: [courseVersion.id] }),
  decisions: many(reviewDecision),
}));
export const reviewDecisionRelations = relations(reviewDecision, ({ one }) => ({
  task: one(reviewTask, { fields: [reviewDecision.reviewTaskId], references: [reviewTask.id] }),
  courseVersion: one(courseVersion, {
    fields: [reviewDecision.courseVersionId],
    references: [courseVersion.id],
  }),
  reviewer: one(user, { fields: [reviewDecision.reviewerId], references: [user.id] }),
}));

// ── Learning ────────────────────────────────────────────────────────────────
export const enrolmentRelations = relations(enrolment, ({ one, many }) => ({
  learner: one(user, { fields: [enrolment.learnerId], references: [user.id] }),
  course: one(course, { fields: [enrolment.courseId], references: [course.id] }),
  courseVersion: one(courseVersion, { fields: [enrolment.courseVersionId], references: [courseVersion.id] }),
  currentStep: one(step, { fields: [enrolment.currentStepId], references: [step.id] }),
  stepProgress: many(stepProgress),
  quizAttempts: many(quizAttempt),
  project: one(project),
  certificate: one(certificate),
}));
export const stepProgressRelations = relations(stepProgress, ({ one }) => ({
  enrolment: one(enrolment, { fields: [stepProgress.enrolmentId], references: [enrolment.id] }),
  step: one(step, { fields: [stepProgress.stepId], references: [step.id] }),
}));
export const quizAttemptRelations = relations(quizAttempt, ({ one }) => ({
  enrolment: one(enrolment, { fields: [quizAttempt.enrolmentId], references: [enrolment.id] }),
  quiz: one(quiz, { fields: [quizAttempt.quizId], references: [quiz.id] }),
}));
export const projectRelations = relations(project, ({ one, many }) => ({
  enrolment: one(enrolment, { fields: [project.enrolmentId], references: [enrolment.id] }),
  course: one(course, { fields: [project.courseId], references: [course.id] }),
  versions: many(projectVersion, { relationName: "project_versions" }),
  currentVersion: one(projectVersion, {
    fields: [project.currentVersionId],
    references: [projectVersion.id],
    relationName: "project_current_version",
  }),
}));
export const projectVersionRelations = relations(projectVersion, ({ one, many }) => ({
  project: one(project, {
    fields: [projectVersion.projectId],
    references: [project.id],
    relationName: "project_versions",
  }),
  artefacts: many(artefact),
}));
export const artefactRelations = relations(artefact, ({ one }) => ({
  projectVersion: one(projectVersion, {
    fields: [artefact.projectVersionId],
    references: [projectVersion.id],
  }),
}));
export const certificateRelations = relations(certificate, ({ one }) => ({
  enrolment: one(enrolment, { fields: [certificate.enrolmentId], references: [enrolment.id] }),
  course: one(course, { fields: [certificate.courseId], references: [course.id] }),
}));

// ── AI ──────────────────────────────────────────────────────────────────────
export const tutorConversationRelations = relations(tutorConversation, ({ many }) => ({
  messages: many(aiMessage),
}));
export const aiMessageRelations = relations(aiMessage, ({ one }) => ({
  conversation: one(tutorConversation, {
    fields: [aiMessage.conversationId],
    references: [tutorConversation.id],
  }),
}));

// ── Safety ──────────────────────────────────────────────────────────────────
export const moderationItemRelations = relations(moderationItem, ({ one }) => ({
  report: one(report, { fields: [moderationItem.reportId], references: [report.id] }),
}));
export const safeguardingCaseRelations = relations(safeguardingCase, ({ many }) => ({
  accessLogs: many(safeguardingAccessLog),
}));
export const safeguardingAccessLogRelations = relations(safeguardingAccessLog, ({ one }) => ({
  case: one(safeguardingCase, { fields: [safeguardingAccessLog.caseId], references: [safeguardingCase.id] }),
}));

// ── Billing and CMS ─────────────────────────────────────────────────────────
export const planRelations = relations(plan, ({ many }) => ({
  subscriptions: many(subscription),
}));
export const subscriptionRelations = relations(subscription, ({ one }) => ({
  family: one(family, { fields: [subscription.familyId], references: [family.id] }),
  plan: one(plan, { fields: [subscription.planId], references: [plan.id] }),
}));
export const pageRelations = relations(page, ({ one, many }) => ({
  versions: many(pageVersion, { relationName: "page_versions" }),
  currentVersion: one(pageVersion, {
    fields: [page.currentVersionId],
    references: [pageVersion.id],
    relationName: "page_current_version",
  }),
}));
export const pageVersionRelations = relations(pageVersion, ({ one }) => ({
  page: one(page, { fields: [pageVersion.pageId], references: [page.id], relationName: "page_versions" }),
}));
