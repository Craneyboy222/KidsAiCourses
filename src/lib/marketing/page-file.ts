import { z } from "zod";
import { LEGAL_DRAFT_BANNER, LEGAL_TO_CONFIRM } from "./site";

/**
 * The format of the site's own pages: Markdown with a small front-matter block.
 *
 *   ---
 *   title: How Coach works
 *   audience: teen
 *   summary: Coach gives hints. It does not do the work for you.
 *   topic: coach
 *   position: 40
 *   ---
 *   Markdown from here on.
 *
 * The files in `content/pages/<kind>/<slug>.md` use it, and so does `page_version.body`: the
 * `page` table has no columns for a summary or a topic, so those two travel at the top of the
 * stored body. Pure: no file system and no database here.
 */
export const PAGE_FILE_KINDS = ["marketing", "help", "legal"] as const;
export type PageFileKind = (typeof PAGE_FILE_KINDS)[number];
export const PAGE_FILE_AUDIENCES = ["everyone", "adult", "teen"] as const;
export type PageFileAudience = (typeof PAGE_FILE_AUDIENCES)[number];

/** Help articles are grouped by topic. Order here is the order on the help page. */
export const HELP_TOPICS = [
  { key: "getting-started", label: "Getting started" },
  { key: "accounts", label: "Accounts and signing in" },
  { key: "consent", label: "Consent and privacy" },
  { key: "tools", label: "Tools and approvals" },
  { key: "coach", label: "Coach" },
  { key: "learning", label: "Courses and time limits" },
  { key: "work", label: "Handing in work and certificates" },
  { key: "safety", label: "Safety and reporting" },
  { key: "billing", label: "Plans and billing" },
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number]["key"];
const HELP_TOPIC_KEYS = HELP_TOPICS.map((topic) => topic.key) as [HelpTopic, ...HelpTopic[]];

export function splitFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const value = line.slice(at + 1).trim();
    // A value may be wrapped in quotes so that it can hold a colon or start with a symbol.
    meta[line.slice(0, at).trim()] = /^(".*"|'.*')$/.test(value) ? value.slice(1, -1) : value;
  }
  return { meta, body: (match[2] ?? "").trim() };
}

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case words joined by hyphens")
  .max(80);

const metaSchema = z.object({
  title: z.string().trim().min(3).max(120),
  audience: z.enum(PAGE_FILE_AUDIENCES).default("everyone"),
  summary: z.string().trim().min(10).max(300).optional(),
  topic: z.enum(HELP_TOPIC_KEYS).optional(),
  position: z.coerce.number().int().min(0).max(10_000).default(0),
});

export type PageFile = {
  kind: PageFileKind;
  slug: string;
  audience: PageFileAudience;
  title: string;
  summary: string | null;
  topic: HelpTopic | null;
  position: number;
  /** Markdown, with no front matter. */
  body: string;
};

/**
 * Checks one page file. Throws an `Error` that names the file and says what is wrong.
 * Legal files must carry the draft banner: only a person removes it, when they publish reviewed text.
 */
export function parsePageFile(raw: string, at: { kind: PageFileKind; slug: string }): PageFile {
  const where = `content/pages/${at.kind}/${at.slug}.md`;
  if (!slugSchema.safeParse(at.slug).success) throw new Error(`${where}: the file name must be lower-case words joined by hyphens`);
  const { meta, body } = splitFrontMatter(raw);
  const parsed = metaSchema.safeParse(meta);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${where}: ${issue?.path.join(".") ?? "front matter"} ${issue?.message ?? "is not valid"}`.trim());
  }
  if (body.length < 40) throw new Error(`${where}: the page has no text`);
  if (/<script|<iframe|<img|<link|<style/i.test(body)) throw new Error(`${where}: pages are Markdown only, with no HTML tags`);
  if (at.kind === "help" && (!parsed.data.topic || !parsed.data.summary)) throw new Error(`${where}: a help article needs a topic and a summary`);
  if (at.kind === "legal" && !isUnreviewedLegalText(body)) {
    throw new Error(`${where}: a legal draft must start with "${LEGAL_DRAFT_BANNER}". Reviewed legal text is published in Studio, not from a file.`);
  }
  return {
    kind: at.kind,
    slug: at.slug,
    audience: parsed.data.audience,
    title: parsed.data.title,
    summary: parsed.data.summary ?? null,
    topic: parsed.data.topic ?? null,
    position: parsed.data.position,
    body,
  };
}

/** The text kept in `page_version.body`: the summary and topic as front matter, then the Markdown. */
export function toStoredBody(page: Pick<PageFile, "summary" | "topic" | "body">): string {
  const lines: string[] = [];
  if (page.summary) lines.push(`summary: ${page.summary.replace(/\r?\n/g, " ")}`);
  if (page.topic) lines.push(`topic: ${page.topic}`);
  return lines.length > 0 ? `---\n${lines.join("\n")}\n---\n${page.body}\n` : `${page.body}\n`;
}

/** The reverse of `toStoredBody`. Anything unexpected in the front matter is ignored, never an error: a page must still render. */
export function fromStoredBody(stored: string): { summary: string | null; topic: HelpTopic | null; body: string } {
  const { meta, body } = splitFrontMatter(stored);
  const topic = HELP_TOPIC_KEYS.find((key) => key === meta.topic) ?? null;
  const summary = meta.summary && meta.summary.trim().length > 0 ? meta.summary.trim() : null;
  return { summary, topic, body };
}

/** True while legal text still says it is a draft or has an open decision in it. */
export function isUnreviewedLegalText(body: string): boolean {
  return body.includes(LEGAL_DRAFT_BANNER) || body.includes(LEGAL_TO_CONFIRM);
}

/** How many decisions are still marked for a lawyer. */
export function countToConfirm(body: string): number {
  return body.split(LEGAL_TO_CONFIRM).length - 1;
}

/**
 * Removes the banner line from the top of a legal draft, so the page can show it once as a proper
 * notice instead of twice. The line is a Markdown quote: `> **Draft — not yet reviewed by a lawyer.** …`.
 */
export function stripDraftBannerLine(body: string): string {
  const lines = body.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1 || !lines[first]?.trimStart().startsWith(">") || !lines[first]?.includes(LEGAL_DRAFT_BANNER)) return body;
  let end = first + 1;
  while (end < lines.length && lines[end]?.trimStart().startsWith(">")) end += 1;
  return lines.slice(end).join("\n").trim();
}
