import { describe, expect, it } from "vitest";
import { MAX_SNIPPET_LINES, detectLeak, referenceOverlap } from "@/server/ai/leak";
import { MEMORY_STEP } from "@/server/ai/memory-deps";

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
