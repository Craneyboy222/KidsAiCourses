import { HELP_TOPICS, type HelpTopic } from "./page-file";

/**
 * Search and filters for the help centre. Pure, so it runs the same on the server and in tests.
 * The help centre is a few dozen short articles: every article is scored in memory, and no
 * search term is ever stored or sent anywhere.
 */
export type HelpArticle = {
  slug: string;
  title: string;
  summary: string | null;
  topic: HelpTopic | null;
  audience: "everyone" | "adult" | "teen";
  position: number;
  body: string;
};

/** Who is reading: `teen` hides articles written for parents, `parent` hides the ones written for teenagers. */
export type HelpReader = "teen" | "parent";

export const HELP_QUERY_MAX = 80;

/** Words too common to help find anything. */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "do", "does", "for", "from", "how", "i", "if", "in", "is", "it",
  "my", "of", "on", "or", "our", "so", "that", "the", "their", "there", "this", "to", "we", "what", "when", "where",
  "who", "why", "will", "with", "you", "your",
]);

/** Different words people use for the same thing in this product. */
const SYNONYMS: Record<string, readonly string[]> = {
  // "in" as well, so that signing in ranks above signing up.
  login: ["sign", "in"],
  log: ["sign", "in"],
  signin: ["sign", "in"],
  password: ["password"],
  passcode: ["password"],
  mum: ["parent"],
  dad: ["parent"],
  carer: ["parent"],
  guardian: ["parent"],
  kid: ["child"],
  son: ["child"],
  daughter: ["child"],
  teenager: ["teen"],
  credits: ["energy"],
  credit: ["energy"],
  tutor: ["coach"],
  chatbot: ["coach"],
  ai: ["coach", "ai"],
  cancel: ["cancel", "billing"],
  pay: ["billing", "plan"],
  payment: ["billing", "plan"],
  price: ["plan", "pricing"],
  cost: ["plan", "pricing"],
  subscription: ["plan", "billing"],
  remove: ["delete"],
  erase: ["delete"],
  export: ["download"],
  screen: ["time"],
  limit: ["cap", "limit"],
  bedtime: ["quiet"],
  upload: ["hand", "upload"],
  submit: ["hand", "submit"],
  certificate: ["certificate"],
  bullying: ["report"],
  unsafe: ["report", "safe"],
  danger: ["danger", "report"],
};

/** Lower-case words with punctuation and accents removed. `don't` becomes `dont`. */
export function tokenise(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

const SUFFIXES = ["ations", "ation", "ions", "ion", "ings", "ing", "ed", "es", "als", "al", "s"] as const;
const MIN_STEM = 4;

/**
 * A light stem, so `approvals`, `approved` and `approving` all meet at `approv`, and
 * `certificate` meets `certificates`. Never shortens a word to fewer than four letters.
 */
export function stem(word: string): string {
  let out = word;
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM) {
      out = word.slice(0, -suffix.length);
      break;
    }
  }
  return out.endsWith("e") && out.length - 1 >= MIN_STEM ? out.slice(0, -1) : out;
}

/** The words of a search worth looking for: no filler words, no duplicates, at most eight. */
export function queryTerms(query: string): string[] {
  const words = tokenise(query.slice(0, HELP_QUERY_MAX)).filter((word) => !STOP_WORDS.has(word));
  const terms = new Set<string>();
  for (const word of words) {
    for (const term of SYNONYMS[word] ?? [word]) terms.add(stem(term));
  }
  return [...terms].slice(0, 8);
}

/** Stems of every word in a piece of text, counted. */
function stemCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of tokenise(text)) {
    const key = stem(word);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function matches(counts: Map<string, number>, term: string): number {
  let found = counts.get(term) ?? 0;
  // A short term also matches the start of a longer word: `certif` finds `certificate`.
  if (found === 0 && term.length >= 4) {
    for (const [word, count] of counts) if (word.startsWith(term)) found += count;
  }
  return found;
}

/**
 * How well an article answers a search. Zero means it does not match. A word in the title counts
 * most, then the summary, then the text (counted at most three times, so a long article cannot
 * win just by being long).
 */
export function scoreArticle(article: Pick<HelpArticle, "title" | "summary" | "body" | "topic">, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const title = stemCounts(article.title);
  const summary = stemCounts(`${article.summary ?? ""} ${article.topic ?? ""}`);
  const body = stemCounts(article.body);
  let score = 0;
  let termsFound = 0;
  for (const term of terms) {
    const points = Math.min(matches(title, term), 1) * 10 + Math.min(matches(summary, term), 1) * 4 + Math.min(matches(body, term), 3);
    if (points > 0) termsFound += 1;
    score += points;
  }
  if (termsFound === 0) return 0;
  // Articles that answer the whole question come before ones that match a single word of it.
  return score * (termsFound / terms.length);
}

/** True when this reader should be offered the article. Articles for everyone are always offered. */
export function isForReader(article: Pick<HelpArticle, "audience">, reader: HelpReader | null): boolean {
  if (reader === null || article.audience === "everyone") return true;
  return reader === "teen" ? article.audience === "teen" : article.audience === "adult";
}

const byPosition = (a: HelpArticle, b: HelpArticle): number => a.position - b.position || a.title.localeCompare(b.title, "en-GB");

/**
 * The articles to show for a search and a reader. With no usable search words every article for
 * that reader comes back in its set order; with words, only matches, best first.
 */
export function searchHelp<T extends HelpArticle>(articles: readonly T[], input: { query?: string | null; reader?: HelpReader | null }): T[] {
  const pool = articles.filter((article) => isForReader(article, input.reader ?? null));
  const terms = queryTerms(input.query ?? "");
  if (terms.length === 0) return [...pool].sort(byPosition);
  return pool
    .map((article) => ({ article, score: scoreArticle(article, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || byPosition(a.article, b.article))
    .map((entry) => entry.article);
}

/** Articles grouped under their topic headings, in the fixed topic order. Empty topics are left out. */
export function groupByTopic<T extends HelpArticle>(articles: readonly T[]): { key: string; label: string; articles: T[] }[] {
  const groups = HELP_TOPICS.map((topic) => ({
    key: topic.key as string,
    label: topic.label as string,
    articles: articles.filter((article) => article.topic === topic.key).sort(byPosition),
  }));
  const other = articles.filter((article) => article.topic === null).sort(byPosition);
  if (other.length > 0) groups.push({ key: "other", label: "Other", articles: other });
  return groups.filter((group) => group.articles.length > 0);
}

/** Reads the `for` filter from the address. Anything else means "everyone". */
export function parseReader(value: string | string[] | undefined): HelpReader | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "teen" || first === "parent" ? first : null;
}

/** Reads the search box from the address: one line, trimmed, never longer than `HELP_QUERY_MAX`. */
export function parseQuery(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return (first ?? "").replace(/\s+/g, " ").trim().slice(0, HELP_QUERY_MAX);
}
