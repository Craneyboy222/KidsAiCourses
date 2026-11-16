/**
 * The built-in fixture model: what Coach "says" when `AI_PROVIDER_MODE=fixture` (the default).
 *
 * It needs no network, no API key and no processor approval, and it is deterministic: the same
 * step notes and the same message always give the same reply. Replies are short and follow the
 * hint ladder, so the app is usable in development and in end-to-end tests. It is not clever and
 * does not try to be: it is a stand-in for a real model, not a substitute for one.
 *
 * It goes through the AI SDK like any other model (`generateText` with a `LanguageModel`), so the
 * gateway code path is the same one a real provider uses.
 */
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";

export const FIXTURE_PROVIDER_KEY = "fixture";
export const FIXTURE_MODEL_ID = "fixture-coach-1";

export type FixtureTurn = {
  instructions: string;
  lastUserMessage: string;
  userTurns: number;
  /** The settings the gateway passed with this call, so a test can check them (and honour the timeout). */
  call?: { providerOptions?: unknown; maxOutputTokens?: number; temperature?: number; abortSignal?: AbortSignal };
};

/**
 * Optional override: return a string to use it as the reply, or undefined to fall back to the
 * built-in one. May be async, so a test can stand in for a slow or failing provider.
 */
export type FixtureScript = (turn: FixtureTurn) => string | undefined | Promise<string | undefined>;

const field = (instructions: string, label: string): string | null => {
  const match = instructions.match(new RegExp(`^${label}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
};

type Topic = { test: RegExp; nudge: string; clue: string; example: string; concept: string };

const TOPICS: Topic[] = [
  {
    test: /\b(error|bug|crash|broken|not working|doesn'?t work|won'?t work|fail|red text|console)\b/i,
    nudge: "Read the error message slowly, right to the end. It usually names a line or a thing it could not find. Which word in it do you recognise from your project?",
    clue: "Most errors like this come from a name that does not match: something is spelt one way where it is made and another way where it is used. Compare the two places letter by letter.",
    example: "Here is a different, smaller case. Say a page has a button named `sendBtn`, but the code looks for `sendButton`. Nothing happens, because that name does not exist. Renaming one to match fixes it. Can you spot a pair like that in yours?",
    concept: "A program only knows the exact names you give it. When it says something is undefined or not found, it means the name it was told to use has not been made at that point. So the fix is nearly always about where and how the name is created.",
  },
  {
    test: /\b(camera|webcam|permission|allow|video feed|microphone)\b/i,
    nudge: "When the page first loaded, did the browser show a small box asking to use the camera? What did you choose?",
    clue: "Browsers remember that choice per site. Look at the icon at the left of the address bar: it shows whether the camera is allowed or blocked for this page.",
    example: "A similar case: a page that asks for your location. If you once pressed Block, it never asks again until you change the site setting. The camera works the same way.",
    concept: "A web page cannot use a camera on its own. It has to ask, the person has to agree, and the page must be loaded securely. If any one of those is missing, the picture stays blank.",
  },
  {
    test: /\b(filter|colour|color|css|style|look|design|layout|font|image|picture)\b/i,
    nudge: "Which part looks different from what you expected: the whole picture, or just one bit of it? Try changing one value by a lot and see what moves.",
    clue: "Visual effects are usually one property with a number. If nothing changes, check that the style is attached to the right element.",
    example: "On a different project, a title stayed black even though the style said blue. The style was written for `.heading` but the title had the class `header`. Matching the names fixed it.",
    concept: "Styles are instructions aimed at named parts of the page. Two things have to be right: the aim (which part) and the instruction (what to change). When a style seems ignored, the aim is usually what's off.",
  },
  {
    test: /\b(timer|countdown|seconds|delay|wait|interval|disappear|time)\b/i,
    nudge: "What should happen when the time runs out, and what happens now instead? Does anything happen at all, or does it happen at the wrong moment?",
    clue: "Timers count in milliseconds, so one second is 1000. A timer that seems to do nothing is often set to a much smaller number than you meant.",
    example: "A different example: to hide a banner after three seconds, you start a timer for 3000 and give it one job, hiding the banner. If the job is run straight away instead of handed to the timer, the banner vanishes at once.",
    concept: "A timer is a promise to do one thing later. You give it two things: what to do, and how long to wait. It does not pause the rest of your program while it waits.",
  },
  {
    test: /\b(chat|message|reply|bot|ai friend|character|prompt|conversation)\b/i,
    nudge: "What do you want the character to say first, and what does it say now? Try the smallest version: one message in, one fixed reply out.",
    clue: "Split it into two jobs: showing what was typed, and choosing what to say back. Get the first one working on its own before the second.",
    example: "A simpler cousin of this: a quiz that shows 'Correct' or 'Try again'. It reads the answer, checks one condition, and shows one of two lines. A pretend chat is the same shape with more lines.",
    concept: "A pretend chat is a loop: read a message, decide on a reply, show it, wait for the next one. Nothing is remembered unless you store it yourself.",
  },
  {
    test: /\b(submit|upload|evidence|screenshot|link|share|publish|private)\b/i,
    nudge: "Which piece of evidence does the step ask for? Check the list on the step and tell me which one you're unsure about.",
    clue: "Before you share a link, open it in a private window. If it asks you to sign in, other people won't be able to see it either.",
    example: "For a different project, the evidence was a screenshot of a finished poster. The learner cropped out their browser tabs first, so nothing personal was showing. The same habit is useful here.",
    concept: "Evidence is there to show that your project works and that it's yours. It should show the project, and nothing about you: no faces, names or account details.",
  },
];

const GENERIC: Topic = {
  test: /./,
  nudge: "Look at the last thing you changed before it stopped doing what you wanted. What was it, and what did you expect it to do?",
  clue: "Try making the problem smaller. Take away one part at a time until it works, and the part you just removed is where to look.",
  example: "Here is how that goes on a different task. A page would not show a picture. Removing the caption changed nothing; removing a stray quote mark in the picture's address fixed it. Small steps found it.",
  concept: "Most stuck moments come down to one of three things: a name that doesn't match, a step done in the wrong order, or a part that was never connected. Checking for those three, one at a time, usually finds it.",
};

/** The built-in reply for a turn. Exported so the tests can pin it. */
export function fixtureReply(turn: FixtureTurn): string {
  const title = field(turn.instructions, "Step title") ?? "this step";
  const rungMatch = turn.instructions.match(/Hint ladder rung for this turn: (\d)/);
  const rung = rungMatch ? Number(rungMatch[1]) : Math.min(5, turn.userTurns);
  const message = turn.lastUserMessage;
  const topic = TOPICS.find((candidate) => candidate.test.test(message)) ?? GENERIC;

  if (/\b(full|whole|complete|entire|finished)\s+(code|solution|answer|project|thing)\b|\bjust (give|tell|show) me\b|\bdo it for me\b|\bthe answer\b/i.test(message)) {
    return `I can't hand over the finished answer for “${title}” — it needs to be your own work. I can get you unstuck, though. What have you tried so far, and what happened when you tried it?`;
  }
  if (/\b(what is|what's|what are|what does|explain|meaning of|mean\??$|how does)\b/i.test(message) && rung >= 2) {
    return `${topic.concept} Does that match what you're seeing in “${title}”?`;
  }
  switch (rung) {
    case 1:
      return `Let's work it out together. What have you tried so far on “${title}”, and what happened when you tried it?`;
    case 2:
      return `Here's a nudge. ${topic.nudge}`;
    case 3:
      return `Here's a clue. ${topic.clue} Have a go, then tell me what you find.`;
    case 4:
      return `${topic.example}`;
    default:
      return `${topic.concept} I might be missing something about your project, so check it against the step's guide. What would you try next?`;
  }
}

const promptText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part: unknown) => (typeof part === "object" && part !== null && "text" in part && typeof (part as { text: unknown }).text === "string" ? (part as { text: string }).text : "")).join("")
      : "";

/** A `LanguageModel` for the AI SDK that answers from `fixtureReply` (or from `script`, when given). */
export function createFixtureModel(script?: FixtureScript): LanguageModel {
  return new MockLanguageModelV4({
    provider: FIXTURE_PROVIDER_KEY,
    modelId: FIXTURE_MODEL_ID,
    doGenerate: async (options) => {
      const instructions = options.prompt.filter((m) => m.role === "system").map((m) => promptText(m.content)).join("\n\n");
      const users = options.prompt.filter((m) => m.role === "user");
      const lastUserMessage = promptText(users[users.length - 1]?.content);
      const turn: FixtureTurn = {
        instructions,
        lastUserMessage,
        userTurns: users.length,
        call: { providerOptions: options.providerOptions, maxOutputTokens: options.maxOutputTokens, temperature: options.temperature, abortSignal: options.abortSignal },
      };
      const text = (await script?.(turn)) ?? fixtureReply(turn);
      const inputTokens = Math.ceil(options.prompt.reduce((sum, m) => sum + promptText(m.content).length, 0) / 4);
      const outputTokens = Math.ceil(text.length / 4);
      return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
