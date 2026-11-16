import { describe, expect, it } from "vitest";
import { COMPLETION_RULES, STEP_TYPES } from "@/content/schema";
import { canSkipStep, courseProgress, evaluateCompletion, isEvidenceRule, resumeStepKey, type ProgressStep } from "@/lib/learning/completion";
import { mergeStepData, readStepData } from "@/lib/learning/step-data";

const done = (check: ReturnType<typeof evaluateCompletion>) => check.complete;
const code = (check: ReturnType<typeof evaluateCompletion>) => (check.complete ? null : check.code);

describe("evaluateCompletion", () => {
  it("view: reading and checkpoint steps are done once seen", () => {
    expect(done(evaluateCompletion({ type: "read", rule: "view" }, {}))).toBe(true);
    expect(done(evaluateCompletion({ type: "checkpoint", rule: "view" }, {}))).toBe(true);
  });

  it("view: a video needs the threshold watched, or the transcript read", () => {
    const video = { type: "video", rule: "view", threshold: 0.8 } as const;
    expect(code(evaluateCompletion(video, {}))).toBe("watch_more");
    expect(code(evaluateCompletion(video, { watchedFraction: 0.79 }))).toBe("watch_more");
    expect(done(evaluateCompletion(video, { watchedFraction: 0.8 }))).toBe(true);
    expect(done(evaluateCompletion(video, { watchedFraction: 0.1, transcriptRead: true }))).toBe(true);
    // No threshold in the course: the default (80%) applies.
    expect(code(evaluateCompletion({ type: "video", rule: "view" }, { watchedFraction: 0.5 }))).toBe("watch_more");
    expect(done(evaluateCompletion({ type: "video", rule: "view", threshold: 0.5 }, { watchedFraction: 0.5 }))).toBe(true);
  });

  it("self_tick: needs the tick, and written steps need words as well", () => {
    expect(code(evaluateCompletion({ type: "external_task", rule: "self_tick" }, {}))).toBe("tick_needed");
    expect(done(evaluateCompletion({ type: "external_task", rule: "self_tick" }, { ticked: true }))).toBe(true);
    for (const type of ["reflection", "ethics_checkpoint"] as const) {
      expect(code(evaluateCompletion({ type, rule: "self_tick" }, { ticked: true }))).toBe("response_needed");
      expect(code(evaluateCompletion({ type, rule: "self_tick" }, { responseLength: 40 }))).toBe("tick_needed");
      expect(done(evaluateCompletion({ type, rule: "self_tick" }, { ticked: true, responseLength: 1 }))).toBe(true);
    }
  });

  it("setup_acknowledged: every guide step ticked, then the acknowledgement", () => {
    const step = { type: "setup_guide", rule: "setup_acknowledged", guideStepIds: ["g1", "g2", "g3"] } as const;
    const check = evaluateCompletion(step, { guideTicks: ["g1"], ticked: true });
    expect(code(check)).toBe("guide_steps_left");
    expect(check.complete ? "" : check.message).toContain("2 setup steps");
    expect(code(evaluateCompletion(step, { guideTicks: ["g1", "g2", "g3"] }))).toBe("tick_needed");
    expect(done(evaluateCompletion(step, { guideTicks: ["g3", "g2", "g1", "extra"], ticked: true }))).toBe(true);
  });

  it("quiz_pass: only a pass will do", () => {
    expect(code(evaluateCompletion({ type: "quiz", rule: "quiz_pass" }, { ticked: true }))).toBe("quiz_not_passed");
    expect(done(evaluateCompletion({ type: "quiz", rule: "quiz_pass" }, { quizPassed: true }))).toBe(true);
  });

  it("evidence rules: submitted is enough to hand in, an upload must be accepted, and a tick never is", () => {
    expect(code(evaluateCompletion({ type: "submit", rule: "submit" }, { ticked: true, evidence: "none" }))).toBe("evidence_needed");
    expect(done(evaluateCompletion({ type: "submit", rule: "submit" }, { evidence: "submitted" }))).toBe(true);
    expect(done(evaluateCompletion({ type: "upload", rule: "evidence_submitted" }, { evidence: "accepted" }))).toBe(true);
    expect(code(evaluateCompletion({ type: "submit", rule: "submit" }, { evidence: "rejected" }))).toBe("evidence_needed");
    expect(code(evaluateCompletion({ type: "upload", rule: "upload_approved" }, { evidence: "submitted" }))).toBe("evidence_not_accepted");
    expect(done(evaluateCompletion({ type: "upload", rule: "upload_approved" }, { evidence: "accepted" }))).toBe(true);
  });

  it("has an answer for every rule and every step type, and every refusal says what to do", () => {
    for (const rule of COMPLETION_RULES) {
      for (const type of STEP_TYPES) {
        const check = evaluateCompletion({ type, rule }, {});
        if (!check.complete) expect(check.message.length).toBeGreaterThan(10);
      }
    }
    expect(COMPLETION_RULES.filter(isEvidenceRule)).toEqual(["upload_approved", "evidence_submitted", "submit"]);
  });
});

describe("skipping, progress and resume", () => {
  it("allows skip-ahead on every step except the final submit", () => {
    expect(STEP_TYPES.filter((type) => !canSkipStep(type))).toEqual(["submit"]);
  });

  const steps: ProgressStep[] = [
    { key: "a", status: "completed", disabled: false },
    { key: "b", status: "skipped", disabled: false },
    { key: "c", status: "not_started", disabled: true },
    { key: "d", status: "in_progress", disabled: false },
  ];

  it("leaves disabled steps out of the count, and a skipped step is not done", () => {
    expect(courseProgress(steps)).toEqual({ total: 3, completed: 1, percent: 33, done: false });
    const finished = steps.map((step) => (step.disabled ? step : { ...step, status: "completed" as const }));
    expect(courseProgress(finished)).toMatchObject({ total: 3, completed: 3, percent: 100, done: true });
    expect(courseProgress([])).toEqual({ total: 0, completed: 0, percent: 0, done: false });
  });

  it("resumes at the stored step if it is unfinished, otherwise the first unfinished one", () => {
    expect(resumeStepKey(steps, "d")).toBe("d");
    expect(resumeStepKey(steps, "a")).toBe("b");
    // A disabled step is never where you resume.
    expect(resumeStepKey(steps, "c")).toBe("b");
    expect(resumeStepKey(steps, "nope")).toBe("b");
    expect(resumeStepKey(steps, null)).toBe("b");
    expect(resumeStepKey([{ key: "a", status: "completed", disabled: false }], "a")).toBe("a");
    expect(resumeStepKey([], "a")).toBeNull();
  });
});

describe("step data from the browser", () => {
  const limits = { hintCount: 3, guideStepIds: ["g1", "g2"] };

  it("drops anything that is not the right shape", () => {
    expect(readStepData(null)).toEqual({});
    expect(readStepData("nope")).toEqual({});
    expect(readStepData({ watchedFraction: 7, position: -4, speed: 9, transcriptRead: "yes", guideTicks: ["g1", 4, "g1"], ticked: "true", hintLevel: 1.5, evidence: "made-up", extra: 1 })).toEqual({
      watchedFraction: 1,
      position: 0,
      guideTicks: ["g1"],
    });
  });

  it("only ever moves progress forward, and never accepts evidence", () => {
    const merged = mergeStepData({ watchedFraction: 0.6, hintLevel: 2, transcriptRead: true, evidence: "submitted" }, { watchedFraction: 0.2, hintLevel: 1, transcriptRead: false, evidence: "accepted", position: 12, speed: 1.5 }, limits);
    expect(merged).toEqual({ watchedFraction: 0.6, hintLevel: 2, transcriptRead: true, evidence: "submitted", position: 12, speed: 1.5 });
    expect(mergeStepData({}, { hintLevel: 40 }, limits).hintLevel).toBe(3);
    expect(mergeStepData({}, { guideTicks: ["g2", "g9"] }, limits).guideTicks).toEqual(["g2"]);
    // A tick can be taken back before the step is completed.
    expect(mergeStepData({ ticked: true }, { ticked: false }, limits).ticked).toBe(false);
  });
});
