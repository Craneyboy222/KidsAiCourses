import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Versioned prompt text lives as data in `content/prompts/*.md` (reviewable in a pull request,
 * and copied into `prompt_template` by the seed). Each file starts with a small front-matter
 * block between `---` lines, which is metadata and never sent to a model.
 */
export type PromptFile = { meta: Record<string, string>; body: string };

const cache = new Map<string, PromptFile>();

export function parsePromptFile(raw: string): PromptFile {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { meta, body: (match[2] ?? "").trim() };
}

/** Reads `content/prompts/<name>.md`. Throws if it is missing: callers fail closed. */
export function readPromptFile(name: "coach.v1" | "crisis-script.v1"): PromptFile {
  const cached = cache.get(name);
  if (cached) return cached;
  // Two literal joins (not one built from `name`) so that the build's file tracer includes both files.
  const path =
    name === "coach.v1"
      ? join(process.cwd(), "content", "prompts", "coach.v1.md")
      : join(process.cwd(), "content", "prompts", "crisis-script.v1.md");
  const parsed = parsePromptFile(readFileSync(path, "utf8"));
  if (parsed.body.length === 0) throw new Error(`Prompt file ${name}.md is empty`);
  cache.set(name, parsed);
  return parsed;
}
