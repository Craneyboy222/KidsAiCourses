/**
 * Quiz grading (spec 3.2: single-choice, multiple-choice, order and spot-the-problem, with
 * feedback after answering, unlimited retries, no timers and a pass mark).
 *
 * Pure. It needs the full quiz, answers included, so it only ever runs on the server: the
 * learner's browser holds `toLearnerCourse(...)`, which has no `correct` flags and no feedback.
 */
import type { Quiz, QuizQuestion } from "@/content/schema";

/** `{ [questionId]: optionIds }`. For an `order` question the ids are in the learner's order. */
export type QuizAnswers = Record<string, string[]>;

export type GradedOption = {
  optionId: string;
  /** For `order`: the option is in the right position. Otherwise: choosing it was right. */
  correct: boolean;
  feedback: string;
};

export type GradedQuestion = {
  questionId: string;
  answered: boolean;
  correct: boolean;
  /** Feedback for the options the learner chose, in the order they gave them. Never the whole answer key. */
  options: GradedOption[];
};

export type QuizResult = {
  /** Whole percentage, 0 to 100. */
  score: number;
  /** The pass mark as a whole percentage. */
  passMark: number;
  passed: boolean;
  correctCount: number;
  total: number;
  questions: GradedQuestion[];
};

/** Keeps only real option ids, once each, in the order given. */
function cleanChoice(question: QuizQuestion, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(question.options.map((option) => option.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !known.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function gradeQuestion(question: QuizQuestion, raw: unknown): GradedQuestion {
  const chosen = cleanChoice(question, raw);
  const byId = new Map(question.options.map((option) => [option.id, option]));
  const answered = chosen.length > 0;

  if (question.kind === "order") {
    // Authored order is the correct order (decision D12).
    const options = chosen.map((optionId, index) => ({
      optionId,
      correct: question.options[index]?.id === optionId,
      feedback: byId.get(optionId)?.feedback ?? "",
    }));
    const correct = chosen.length === question.options.length && options.every((option) => option.correct);
    return { questionId: question.id, answered, correct, options };
  }

  const options = chosen.map((optionId) => {
    const option = byId.get(optionId);
    return { optionId, correct: option?.correct === true, feedback: option?.feedback ?? "" };
  });

  if (question.kind === "multi") {
    const wanted = question.options.filter((option) => option.correct).map((option) => option.id);
    const correct = wanted.length === chosen.length && wanted.every((id) => chosen.includes(id));
    return { questionId: question.id, answered, correct, options };
  }

  // `single` and `spot_the_problem`: exactly one pick, and it has to be a right one.
  const correct = chosen.length === 1 && options[0]?.correct === true;
  return { questionId: question.id, answered, correct, options };
}

/**
 * Grades a whole attempt. `passFraction` is the step's completion threshold when it has one,
 * otherwise the quiz's own pass mark. Questions left blank count as wrong.
 */
export function gradeQuiz(quiz: Quiz, answers: unknown, passFraction: number = quiz.passMark): QuizResult {
  const given: Record<string, unknown> = typeof answers === "object" && answers !== null && !Array.isArray(answers) ? (answers as Record<string, unknown>) : {};
  const questions = quiz.questions.map((question) => gradeQuestion(question, given[question.id]));
  const total = questions.length;
  const correctCount = questions.filter((question) => question.correct).length;
  const fraction = total === 0 ? 0 : correctCount / total;
  const mark = Math.min(1, Math.max(0, passFraction));
  return {
    score: Math.round(fraction * 100),
    passMark: Math.round(mark * 100),
    passed: total > 0 && fraction + 1e-9 >= mark,
    correctCount,
    total,
    questions,
  };
}

/** The cleaned answers that are stored with an attempt: known questions and options only. */
export function storedAnswers(quiz: Quiz, answers: unknown): QuizAnswers {
  const given: Record<string, unknown> = typeof answers === "object" && answers !== null && !Array.isArray(answers) ? (answers as Record<string, unknown>) : {};
  return Object.fromEntries(quiz.questions.map((question) => [question.id, cleanChoice(question, given[question.id])]));
}
