/**
 * Solution-leak check for Coach replies (stage 9, spec Section 8).
 *
 * Coach may show a short illustrative snippet. It must never hand over the step's solution, a
 * whole file of code, or a finished piece of writing. A reply counts as a leak when it:
 *  - contains a code block longer than a short snippet, or a lot of code in total;
 *  - substantially reproduces the step's reference solution (when the step has one);
 *  - reads as a complete essay-style answer rather than a hint.
 *
 * Pure and deterministic. A leak makes the pipeline regenerate once with a corrective
 * instruction; a second leak becomes a safe refusal.
 */

export type LeakReason = "long_code_block" | "too_much_code" | "reference_solution" | "essay_answer" | "too_long";

export type LeakResult = { leak: boolean; reasons: LeakReason[] };

/** A "short illustrative snippet": at most this many non-empty lines in one block. */
export const MAX_SNIPPET_LINES = 6;
export const MAX_SNIPPET_CHARS = 400;
/** Across all blocks in one reply. */
export const MAX_TOTAL_CODE_LINES = 10;
/** Coach replies are meant to be about 120 words. Past this, it is writing the work, not hinting. */
export const MAX_REPLY_WORDS = 260;
export const MAX_PROSE_WORDS = 180;

const FENCE = /(```|~~~)[^\n]*\n([\s\S]*?)(?:\n\1|$)/g;

const nonEmptyLines = (text: string): string[] => text.split(/\r?\n/).filter((line) => line.trim().length > 0);

/** Lines that look like code even without a fence. */
const CODE_LINE =
  /^\s*(?:(?:const|let|var|function|class|import|export|return|if|else|for|while|switch|case|try|catch|def|elif|print|from|async|await|public|private|static|void|int|string|bool|echo|SELECT|INSERT|UPDATE|DELETE|CREATE)\b.*|[\w$.[\]"']+\s*(?:=|\+=|-=|=>)\s*.+|.*[;{}]\s*$|<\/?[a-z][\w-]*(?:\s[^>]*)?>.*|[.#]?[\w-]+\s*\{.*|\s{2,}[\w-]+\s*:\s*[^;]+;|[\w$.]+\([^)]*\)\s*;?|@\w+.*|#include.*|\}\s*(?:else|catch|finally)?.*)$/;

function codeBlocks(reply: string): string[] {
  const blocks: string[] = [];
  for (const match of reply.matchAll(FENCE)) blocks.push(match[2] ?? "");
  return blocks;
}

function unfencedCodeRun(replyWithoutFences: string): number {
  let longest = 0;
  let run = 0;
  for (const line of replyWithoutFences.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    if (CODE_LINE.test(line) && !/^\s*(?:[-*]|\d+[.)])\s+\w+(?:\s+\w+){4,}/.test(line)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return longest;
}

const tokens = (text: string): string[] => text.toLowerCase().match(/[a-z0-9_$]+|[^\sa-z0-9_$]/g) ?? [];

function shingles(words: string[], size: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) set.add(words.slice(i, i + size).join(" "));
  return set;
}

/**
 * How much of the reference appears in the reply: the share of the reference's token 5-grams
 * that the reply also contains (0–1). Whitespace, case and line breaks do not matter.
 */
export function referenceOverlap(reply: string, reference: string): number {
  const ref = tokens(reference);
  const size = ref.length >= 12 ? 5 : Math.max(2, Math.min(3, ref.length));
  const refShingles = shingles(ref, size);
  if (refShingles.size === 0) return 0;
  const replyShingles = shingles(tokens(reply), size);
  let shared = 0;
  for (const shingle of refShingles) if (replyShingles.has(shingle)) shared += 1;
  return shared / refShingles.size;
}

/** Longest run of reference tokens that appears, in order and unbroken, in the reply. */
function longestSharedRun(reply: string, reference: string): number {
  const a = tokens(reply);
  const b = tokens(reference);
  if (a.length === 0 || b.length === 0) return 0;
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        const value = (previous[j - 1] ?? 0) + 1;
        current[j] = value;
        if (value > best) best = value;
      }
    }
    previous = current;
  }
  return best;
}

const ESSAY_MARKERS =
  /\b(?:in conclusion|to conclude|in summary|to sum up|overall,? (?:it|this|i)|firstly|secondly|thirdly|furthermore|moreover|on the other hand|this essay|this shows that|this suggests that|in this (?:essay|reflection|piece)|introduction:|conclusion:|paragraph \d|here(?:'s| is) (?:your|the|a) (?:full|finished|complete|final|whole) (?:essay|answer|reflection|paragraph|text|write-?up|script|caption|description)|you can (?:copy|paste|submit|hand in|use) (?:this|it|the (?:text|above|following))|copy and paste (?:this|the following))\b/i;

function proseStats(replyWithoutCode: string): { words: number; longParagraphs: number; questions: number } {
  const paragraphs = replyWithoutCode
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^(?:[-*]|\d+[.)])\s/.test(p));
  let words = 0;
  let longParagraphs = 0;
  for (const paragraph of paragraphs) {
    const count = paragraph.split(/\s+/).filter(Boolean).length;
    words += count;
    if (count >= 45) longParagraphs += 1;
  }
  return { words, longParagraphs, questions: (replyWithoutCode.match(/\?/g) ?? []).length };
}

export type LeakInput = {
  reply: string;
  /** The step's reference solution, when the author supplied one (`config.referenceSolution`). */
  referenceSolution?: string | null;
};

export function detectLeak({ reply, referenceSolution }: LeakInput): LeakResult {
  const reasons = new Set<LeakReason>();

  const blocks = codeBlocks(reply);
  let totalCodeLines = 0;
  for (const block of blocks) {
    const lines = nonEmptyLines(block).length;
    totalCodeLines += lines;
    if (lines > MAX_SNIPPET_LINES || block.trim().length > MAX_SNIPPET_CHARS) reasons.add("long_code_block");
  }
  const withoutFences = reply.replace(FENCE, "\n");
  const unfenced = unfencedCodeRun(withoutFences);
  if (unfenced > MAX_SNIPPET_LINES) reasons.add("long_code_block");
  if (totalCodeLines + unfenced > MAX_TOTAL_CODE_LINES) reasons.add("too_much_code");

  const reference = referenceSolution?.trim();
  if (reference) {
    const refTokens = tokens(reference).length;
    const overlap = referenceOverlap(reply, reference);
    const run = longestSharedRun(reply, reference);
    // Half of the solution's phrasing, or one long unbroken stretch of it, is the solution.
    if (overlap >= 0.5 || run >= Math.max(25, Math.ceil(refTokens * 0.6)) || (refTokens <= 12 && run >= refTokens)) {
      reasons.add("reference_solution");
    }
  }

  const totalWords = reply.split(/\s+/).filter(Boolean).length;
  if (totalWords > MAX_REPLY_WORDS) reasons.add("too_long");
  const prose = proseStats(withoutFences);
  const essayLike = ESSAY_MARKERS.test(withoutFences);
  if (prose.words > MAX_PROSE_WORDS && prose.questions <= 1) reasons.add("essay_answer");
  if (essayLike && (prose.words >= 90 || prose.longParagraphs >= 2)) reasons.add("essay_answer");
  if (prose.longParagraphs >= 3) reasons.add("essay_answer");

  return { leak: reasons.size > 0, reasons: [...reasons] };
}
