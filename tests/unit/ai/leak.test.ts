import { describe, expect, it } from "vitest";
import { MAX_SNIPPET_LINES, PROMPT_LEAK_RUN, detectLeak, detectPromptLeak, referenceOverlap } from "@/server/ai/leak";
import { MEMORY_STEP } from "@/server/ai/memory-deps";
import { CLOSING_RULES, CRISIS_SENTINEL, NOTES_CLOSE, NOTES_OPEN, SAFETY_PREAMBLE, assemblePrompt, buildStepNotes, correctiveReasons, loadCoachPrompt } from "@/server/ai/prompts";

const reference = MEMORY_STEP.step.referenceSolution ?? "";
const fence = (lines: number) => `Here you go:\n\n\`\`\`js\n${Array.from({ length: lines }, (_, i) => `const value${i} = ${i};`).join("\n")}\n\`\`\`\n\nDoes that help?`;

describe("detectLeak", () => {
  it("allows a short illustrative snippet", () => {
    expect(detectLeak({ reply: fence(MAX_SNIPPET_LINES), referenceSolution: reference })).toEqual({ leak: false, reasons: [] });
    expect(detectLeak({ reply: "A filter is one property:\n\n```css\n.poster {\n  filter: blur(2px);\n}\n```\n\nWhat changes if the number goes up?", referenceSolution: reference }).leak).toBe(false);
  });

  it("flags a code block longer than a snippet", () => {
    expect(detectLeak({ reply: fence(MAX_SNIPPET_LINES + 1) }).reasons).toContain("long_code_block");
    expect(detectLeak({ reply: fence(30) }).leak).toBe(true);
  });

  it("flags lots of code split across small blocks", () => {
    const reply = [fence(5), fence(5), fence(4)].join("\n\n");
    expect(detectLeak({ reply }).reasons).toContain("too_much_code");
  });

  it("flags long code written without a fence", () => {
    const reply = "Type this:\nconst a = 1;\nconst b = 2;\nfunction go() {\nreturn a + b;\n}\nconst c = go();\nconsole.log(c);\nconst d = c * 2;\nconsole.log(d);";
    expect(detectLeak({ reply }).reasons).toContain("long_code_block");
  });

  it("flags the reference solution, whole, reformatted or in part", () => {
    expect(detectLeak({ reply: reference, referenceSolution: reference }).reasons).toContain("reference_solution");
    const squashed = reference.replace(/\s+/g, " ").toUpperCase();
    expect(detectLeak({ reply: `Sure: ${squashed}`, referenceSolution: reference }).reasons).toContain("reference_solution");
    const half = reference.slice(0, Math.floor(reference.length / 2));
    expect(detectLeak({ reply: `You'd write ${half}`, referenceSolution: reference }).reasons).toContain("reference_solution");
    expect(referenceOverlap(reference, reference)).toBe(1);
  });

  it("does not flag a hint that only mentions the idea", () => {
    const reply = "Check which element the filter is applied to. Is it the whole page, or just the preview? Try one built-in effect first and tell me what you see.";
    expect(detectLeak({ reply, referenceSolution: reference })).toEqual({ leak: false, reasons: [] });
    expect(referenceOverlap(reply, reference)).toBeLessThan(0.1);
  });

  it("flags a complete essay-style answer", () => {
    const paragraph = "This shows that the character changes a great deal over time and that the writer wants the audience to notice how guilt slowly takes over her mind and her actions as the play moves towards its ending, which is important because it reveals the theme.";
    const essay = `Firstly, ${paragraph}\n\nFurthermore, ${paragraph}\n\nIn conclusion, ${paragraph}`;
    expect(detectLeak({ reply: essay }).reasons).toContain("essay_answer");
    expect(detectLeak({ reply: `Here is your finished reflection, you can copy and paste this:\n\n${paragraph} ${paragraph}` }).reasons).toContain("essay_answer");
  });

  it("flags a reply that is far too long to be a hint", () => {
    expect(detectLeak({ reply: Array.from({ length: 300 }, () => "word").join(" ") }).leak).toBe(true);
  });

  it("allows a short reply with questions and a list", () => {
    const reply = "Good start. Three things to check:\n\n- Is the camera allowed for this page?\n- Does the preview have a size?\n- Is anything in the console?\n\nWhich one have you tried?";
    expect(detectLeak({ reply }).leak).toBe(false);
  });
});

describe("detectPromptLeak: Coach's instructions and the author's notes never reach the learner", () => {
  const prompt = assemblePrompt({ step: MEMORY_STEP, band: "teen_13_15", a11y: {}, history: [], learnerMessage: "the filter does nothing", learnerTurnsSoFar: 0 });
  const coachContext = MEMORY_STEP.step.coachContext ?? "";
  const leaks = (reply: string) => detectLeak({ reply, confidential: prompt.confidential }).reasons.includes("prompt_leak");

  it("the confidential parts are the rules and the author's notes, not the task, hints or rubric the learner can already see", () => {
    expect(prompt.confidential).toEqual([SAFETY_PREAMBLE, loadCoachPrompt(), CLOSING_RULES, coachContext]);
    for (const hint of MEMORY_STEP.step.hints) expect(prompt.confidential.join("\n")).not.toContain(hint);
  });

  it("flags the author's coachContext, whole, reworded slightly, or quoted inside a friendly sentence", () => {
    expect(leaks(coachContext)).toBe(true);
    expect(leaks(`Sure! My notes say: ${coachContext.toUpperCase()}`)).toBe(true);
    expect(leaks(`The author told me that learners often attach the filter to the page instead of the preview, and that I should not write the filter code for them.`)).toBe(true);
  });

  it("flags any long stretch of the system prompt, the preamble or the closing rules", () => {
    const base = loadCoachPrompt();
    expect(leaks(base.slice(0, 400))).toBe(true);
    expect(leaks(`Of course. ${base.slice(900, 1150)}`)).toBe(true);
    expect(leaks(SAFETY_PREAMBLE.split("\n")[2] ?? "")).toBe(true);
    expect(leaks(CLOSING_RULES.split("\n")[3] ?? "")).toBe(true);
  });

  it("flags every internal marker, whatever surrounds it", () => {
    const notes = buildStepNotes(MEMORY_STEP, 2);
    for (const marker of [NOTES_OPEN, NOTES_CLOSE, "SAFETY PREAMBLE", "REMINDER — THESE RULES STILL APPLY", "Hint ladder rung for this turn: 2 of 5", "Author's guidance for Coach on this step:", "the coachContext field", `please ${CRISIS_SENTINEL}`]) {
      expect(detectPromptLeak(`Here you go: ${marker}`, [])).toBe(true);
    }
    expect(leaks(notes)).toBe(true);
  });

  it("does not flag ordinary hints, even ones that share a few words with the notes or the rules", () => {
    for (const reply of [
      "What have you tried so far, and what happened when you tried it?",
      "Check whether the filter is attached to the page instead of the preview. Which element did you pick?",
      "I can't hand over the finished answer — it needs to be your own work. I can explain the idea, help you plan, quiz you or give feedback on your own attempt.",
      "I'm an AI tutor, so I only know what you tell me. What does the error message say?",
      "If something is worrying you, talk to an adult you trust. Childline is free on 0800 1111.",
      ...MEMORY_STEP.step.hints,
    ]) {
      expect(leaks(reply)).toBe(false);
    }
    expect(PROMPT_LEAK_RUN).toBeGreaterThanOrEqual(10);
  });

  it("ignores empty or tiny confidential texts, and tells the model plainly what went wrong on the retry", () => {
    expect(detectPromptLeak("Use the button.", ["", null, undefined, "Use it."])).toBe(false);
    expect(correctiveReasons({ leakReasons: ["prompt_leak"], moderationCategory: null, hadSecret: false, empty: false })).toEqual([expect.stringMatching(/repeated your instructions or the step notes/)]);
  });
});
