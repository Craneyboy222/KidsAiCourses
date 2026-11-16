/**
 * Paths for `EditableText` / `EditableBlock` (src/components/course/Editable.tsx).
 *
 * A path addresses one value inside the Course JSON by id, never by array index, so it stays
 * right when an editor reorders things: `modules[m2].lessons[m2l1].steps[s3].title`,
 * `quizzes[q-snaplab-1].questions[q1].options[a].text`, `setupGuides[guide-replit].steps[g1].body`.
 * Plain string lists have no ids, so their items use the position: `…steps[s3].hints[0]`,
 * `projectBrief.deliverables[1]`, `rubric.criteria[c1].levels[0].descriptor`.
 */
export const coursePaths = {
  module: (moduleId: string) => `modules[${moduleId}]`,
  lesson: (moduleId: string, lessonId: string) => `modules[${moduleId}].lessons[${lessonId}]`,
  step: (moduleId: string, lessonId: string, stepId: string) => `modules[${moduleId}].lessons[${lessonId}].steps[${stepId}]`,
  quiz: (quizId: string) => `quizzes[${quizId}]`,
  question: (quizId: string, questionId: string) => `quizzes[${quizId}].questions[${questionId}]`,
  option: (quizId: string, questionId: string, optionId: string) => `quizzes[${quizId}].questions[${questionId}].options[${optionId}]`,
  guide: (guideId: string) => `setupGuides[${guideId}]`,
  guideStep: (guideId: string, stepId: string) => `setupGuides[${guideId}].steps[${stepId}]`,
  criterion: (criterionId: string) => `rubric.criteria[${criterionId}]`,
  toolRequirement: (toolSlug: string) => `toolRequirements[${toolSlug}]`,
} as const;
