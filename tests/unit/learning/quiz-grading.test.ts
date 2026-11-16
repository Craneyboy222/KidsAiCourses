import { describe, expect, it } from "vitest";
import { toLearnerCourse, type Quiz } from "@/content/schema";
import { gradeQuestion, gradeQuiz, storedAnswers } from "@/lib/learning/quiz-grading";
import { ensureLearnerCourse, hasInternalContent } from "@/lib/learning/safe-course";
import { toCourseOutline } from "@/lib/learning/outline";
import { snapchatCourse } from "../content/helpers";

const quiz: Quiz = {
  id: "q",
  title: "Fixture",
  passMark: 0.75,
  questions: [
    { id: "single", kind: "single", prompt: "Pick one", options: [{ id: "a", text: "A", correct: true, feedback: "Yes, A." }, { id: "b", text: "B", correct: false, feedback: "Not B." }, { id: "c", text: "C", correct: false, feedback: "Not C." }] },
    { id: "multi", kind: "multi", prompt: "Pick all", options: [{ id: "a", text: "A", correct: true, feedback: "A fits." }, { id: "b", text: "B", correct: true, feedback: "B fits." }, { id: "c", text: "C", correct: false, feedback: "C does not." }] },
    { id: "order", kind: "order", prompt: "Order", options: [{ id: "one", text: "1", correct: true, feedback: "First." }, { id: "two", text: "2", correct: true, feedback: "Second." }, { id: "three", text: "3", correct: true, feedback: "Third." }] },
    { id: "spot", kind: "spot_the_problem", prompt: "Spot", options: [{ id: "ok", text: "Fine", correct: false, feedback: "That one is fine." }, { id: "bad", text: "Problem", correct: true, feedback: "That is the problem." }] },
  ],
};
const [single, multi, order, spot] = quiz.questions as [Quiz["questions"][0], Quiz["questions"][0], Quiz["questions"][0], Quiz["questions"][0]];

describe("gradeQuestion", () => {
  it("single: exactly one pick, and it must be the right one", () => {
    expect(gradeQuestion(single, ["a"])).toEqual({ questionId: "single", answered: true, correct: true, options: [{ optionId: "a", correct: true, feedback: "Yes, A." }] });
    expect(gradeQuestion(single, ["b"])).toMatchObject({ correct: false, options: [{ optionId: "b", correct: false, feedback: "Not B." }] });
    // Sending every option does not win.
    expect(gradeQuestion(single, ["a", "b", "c"]).correct).toBe(false);
    expect(gradeQuestion(single, [])).toMatchObject({ answered: false, correct: false, options: [] });
  });

  it("multi: the chosen set must equal the correct set", () => {
    expect(gradeQuestion(multi, ["b", "a"]).correct).toBe(true);
    expect(gradeQuestion(multi, ["a"]).correct).toBe(false);
    expect(gradeQuestion(multi, ["a", "b", "c"]).correct).toBe(false);
    expect(gradeQuestion(multi, ["a", "c"]).options).toEqual([
      { optionId: "a", correct: true, feedback: "A fits." },
      { optionId: "c", correct: false, feedback: "C does not." },
    ]);
  });

  it("order: authored order is the answer, and each item is marked by position", () => {
    expect(gradeQuestion(order, ["one", "two", "three"]).correct).toBe(true);
    const wrong = gradeQuestion(order, ["two", "one", "three"]);
    expect(wrong.correct).toBe(false);
    expect(wrong.options.map((option) => option.correct)).toEqual([false, false, true]);
    // An incomplete order is wrong even if what is there is in the right place.
    expect(gradeQuestion(order, ["one", "two"]).correct).toBe(false);
  });

  it("spot the problem: pick the one with the problem", () => {
    expect(gradeQuestion(spot, ["bad"]).correct).toBe(true);
    expect(gradeQuestion(spot, ["ok"])).toMatchObject({ correct: false, options: [{ optionId: "ok", correct: false, feedback: "That one is fine." }] });
    expect(gradeQuestion(spot, ["ok", "bad"]).correct).toBe(false);
  });

  it("ignores made-up option ids, repeats and anything that is not a list of strings", () => {
    expect(gradeQuestion(single, ["zzz", "a", "a"]).correct).toBe(true);
    expect(gradeQuestion(single, "a")).toMatchObject({ answered: false, correct: false });
    expect(gradeQuestion(multi, [1, null, { id: "a" }])).toMatchObject({ answered: false, correct: false });
  });
});

describe("gradeQuiz", () => {
  const allRight = { single: ["a"], multi: ["a", "b"], order: ["one", "two", "three"], spot: ["bad"] };

  it("scores, applies the pass mark and never returns the answer key", () => {
    expect(gradeQuiz(quiz, allRight)).toMatchObject({ score: 100, passMark: 75, passed: true, correctCount: 4, total: 4 });
    const three = gradeQuiz(quiz, { ...allRight, spot: ["ok"] });
    expect(three).toMatchObject({ score: 75, passed: true, correctCount: 3 });
    const two = gradeQuiz(quiz, { single: ["b"], multi: ["a", "b"], order: ["one", "two", "three"], spot: ["ok"] });
    expect(two).toMatchObject({ score: 50, passed: false, correctCount: 2 });
    // Feedback is only for what was chosen: the right answers to the wrong questions are not in there.
    const text = JSON.stringify(two);
    expect(text).not.toContain("Yes, A.");
    expect(text).not.toContain("That is the problem.");
  });

  it("uses the step's threshold when given, and treats two out of three as passing 0.66", () => {
    const three: Quiz = { ...quiz, passMark: 0.66, questions: quiz.questions.slice(0, 3) };
    expect(gradeQuiz(three, { single: ["a"], multi: ["a", "b"], order: [] }).passed).toBe(true);
    expect(gradeQuiz(three, { single: ["a"], multi: ["a", "b"], order: [] }, 0.9).passed).toBe(false);
    expect(gradeQuiz(three, { single: ["a"] }).passed).toBe(false);
  });

  it("copes with no answers, junk input and an empty quiz", () => {
    expect(gradeQuiz(quiz, {})).toMatchObject({ score: 0, passed: false, correctCount: 0 });
    expect(gradeQuiz(quiz, null).passed).toBe(false);
    expect(gradeQuiz(quiz, ["a"]).passed).toBe(false);
    expect(gradeQuiz({ ...quiz, questions: [] }, {}).passed).toBe(false);
    expect(storedAnswers(quiz, { single: ["a", "zzz"], other: ["x"] })).toEqual({ single: ["a"], multi: [], order: [], spot: [] });
  });
});

describe("what a learner is sent", () => {
  it("strips a full course exactly once, and leaves an already-safe one alone", () => {
    const full = snapchatCourse();
    full.editorNotes = "Staff only";
    expect(hasInternalContent(full)).toBe(true);
    const safe = ensureLearnerCourse(full);
    expect(hasInternalContent(safe)).toBe(false);
    expect(JSON.stringify(safe)).not.toMatch(/"correct"|"feedback"|"coachContext"|editorNotes|Staff only/);
    // A second pass must not shuffle `order` questions again: the same object comes back.
    expect(ensureLearnerCourse(safe)).toBe(safe);
    expect(ensureLearnerCourse(toLearnerCourse(full))).toEqual(safe);
  });

  it("builds a course outline with no step content in it", () => {
    const outline = toCourseOutline(snapchatCourse());
    const text = JSON.stringify(outline);
    expect(text).not.toMatch(/"body"|"hints"|"config"|"quizzes"|"coachContext"|"completion"|"assetIds"/);
    expect(outline.stepCount).toBe(16);
    expect(outline.firstStepKey).toBe("s1");
    expect(outline.trailerCompanionAssetIds).toEqual(["vtt-snaplab-trailer", "tx-snaplab-trailer"]);
    expect(Object.keys(outline.setupGuides[0] ?? {}).sort()).toEqual(["id", "lastVerifiedAt", "title", "toolSlug"]);
    // Building an outline from an outline changes nothing.
    expect(toCourseOutline(outline)).toEqual(outline);
  });
});
