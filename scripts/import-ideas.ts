/**
 * `pnpm ideas:import` — loads `content/course-ideas.json` into the `course_idea` backlog
 * (spec 6.3 "Course ideas backlog", decisions D5–D7).
 *
 * Field mapping: `id` → `idea_key`, `level` → `difficulty` (lower case), `description` →
 * `summary`, category display name → category slug. Every idea starts with status `idea` and no
 * pathways. `examIntegrity` is derived from the watch note; a watch note that mentions
 * "tools 18+" also sets the 18+ tools flag (IDEA-141, IDEA-154); IDEA-157 has a minimum age of 15.
 * The idea-level `safeguarding` flag is a watch-out only. It is NOT `safeguardingSensitive`.
 *
 * Safe to run again: an idea is matched on `idea_key`. `course_idea` has no "edited by a person"
 * column, so an idea counts as untouched while `updated_at` equals `created_at` (this importer
 * keeps them equal on its own updates). An idea anyone or anything else has changed is never
 * overwritten. No idea is invented: only what is in the file is imported.
 *
 * Loads `.env.local` unless `DOTENV_PATH` names another file.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  categorySlugFromLabel,
  difficultyFromLabel,
  type CategorySlug,
  type Difficulty,
} from "@/content/schema";
import { audit } from "@/server/audit";
import { assertCan, systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { closeDb, course, courseIdea, db } from "@/server/db";
import { AppError } from "@/server/errors";
import { canonicalJson, linkCourseToIdea } from "@/server/services/course-store";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Decision D7: the course table in spec Section 15 wins over the ideas file. */
export const IDEA_MIN_AGE_OVERRIDES: Readonly<Record<string, number>> = { "IDEA-157": 15 };

const sourceIdeaSchema = z.object({
  id: z.string().regex(/^IDEA-\d{3,}$/),
  title: z.string().trim().min(1),
  category: z.string().trim().min(1),
  level: z.string().trim().min(1),
  minAge: z.number().int().min(13).max(18),
  flags: z.object({ age18Tools: z.boolean(), safeguarding: z.boolean() }),
  description: z.string().trim().min(1),
  careers: z.string().nullable().optional(),
  watchNote: z.string().nullable().optional(),
  suggestedForLaunch: z.boolean().optional(),
});
const ideasFileSchema = z.object({ ideas: z.array(sourceIdeaSchema) });
export type SourceIdea = z.infer<typeof sourceIdeaSchema>;

export interface IdeaFields {
  ideaKey: string;
  title: string;
  summary: string;
  category: CategorySlug;
  difficulty: Difficulty;
  minAge: number;
  flags: { age18Tools: boolean; safeguarding: boolean; examIntegrity: boolean };
  watchNote: string | null;
  careers: string | null;
  suggestedForLaunch: boolean;
}

/** Maps one idea from the file to the `course_idea` columns (decisions D5–D7). Pure. */
export function mapIdea(source: SourceIdea): IdeaFields {
  const category = categorySlugFromLabel(source.category);
  if (category === undefined)
    throw new AppError(
      "invalid_input",
      `${source.id}: "${source.category}" is not one of the 24 categories.`,
    );
  const difficulty = difficultyFromLabel(source.level);
  if (difficulty === undefined)
    throw new AppError("invalid_input", `${source.id}: "${source.level}" is not Starter, Builder or Pro.`);
  const watchNote = source.watchNote?.trim() || null;
  return {
    ideaKey: source.id,
    title: source.title,
    summary: source.description,
    category,
    difficulty,
    minAge: IDEA_MIN_AGE_OVERRIDES[source.id] ?? source.minAge,
    flags: {
      // D6: a watch note that mentions 18+ tools sets the flag even where the source did not.
      age18Tools: source.flags.age18Tools || (watchNote !== null && /tools\s+18\+/i.test(watchNote)),
      safeguarding: source.flags.safeguarding,
      // D5: derived from the watch note.
      examIntegrity: watchNote !== null && /exam integrity/i.test(watchNote),
    },
    watchNote,
    careers: source.careers?.trim() || null,
    suggestedForLaunch: source.suggestedForLaunch ?? false,
  };
}

/** Reads and maps the ideas file. Throws if the file is missing, malformed or repeats an id. */
export function loadIdeas(file: string = join(REPO_ROOT, "content", "course-ideas.json")): IdeaFields[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new AppError(
      "invalid_input",
      `The ideas file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = ideasFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError(
      "invalid_input",
      `The ideas file is not in the expected shape (${first?.path.join(".")}: ${first?.message}).`,
    );
  }
  const ideas = parsed.data.ideas.map(mapIdea);
  const seen = new Set<string>();
  for (const idea of ideas) {
    if (seen.has(idea.ideaKey))
      throw new AppError("invalid_input", `The ideas file lists ${idea.ideaKey} twice.`);
    seen.add(idea.ideaKey);
  }
  return ideas;
}

export interface IdeaImportResult {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Ideas left alone because something other than this importer changed them. */
  keptEdited: number;
  /** Ideas newly linked to a course with the same title. */
  linked: number;
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const titleKey = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Links each backlog idea that has no course to the course with exactly the same title, in either
 * import order, so that publishing the course marks the idea `published` (decision D5).
 */
export async function linkIdeasToCourses(ctx: Ctx): Promise<number> {
  const courses = await ctx.db
    .select({ id: course.id, title: course.title })
    .from(course)
    .where(isNull(course.sourceIdeaId));
  if (courses.length === 0) return 0;
  const ideas = await ctx.db
    .select({ id: courseIdea.id, title: courseIdea.title })
    .from(courseIdea)
    .where(isNull(courseIdea.courseId));
  const byTitle = new Map(ideas.map((idea) => [titleKey(idea.title), idea.id]));
  let linked = 0;
  for (const item of courses) {
    const ideaId = byTitle.get(titleKey(item.title));
    if (ideaId === undefined) continue;
    await linkCourseToIdea(ctx, item.id, ideaId);
    byTitle.delete(titleKey(item.title));
    linked += 1;
  }
  return linked;
}

/** Imports the ideas backlog (`idea.manage`). Safe to run again; see the file comment. */
export async function importIdeas(ctx: Ctx, options: { file?: string } = {}): Promise<IdeaImportResult> {
  assertCan(ctx.actor, "idea.manage");
  const ideas = loadIdeas(options.file);
  const result: IdeaImportResult = {
    total: ideas.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    keptEdited: 0,
    linked: 0,
  };

  await ctx.db.transaction(async (tx) => {
    const existing = new Map((await tx.select().from(courseIdea)).map((row) => [row.ideaKey, row]));
    const fresh = ideas.filter((idea) => !existing.has(idea.ideaKey));
    if (fresh.length > 0) {
      await tx
        .insert(courseIdea)
        .values(fresh.map((idea) => ({ ...idea, status: "idea" as const, pathways: [] })))
        .onConflictDoNothing({ target: courseIdea.ideaKey });
      result.inserted = fresh.length;
    }
    for (const idea of ideas) {
      const row = existing.get(idea.ideaKey);
      if (!row) continue;
      const changed = (Object.keys(idea) as Array<keyof IdeaFields>).filter(
        (key) => !same(row[key], idea[key]),
      );
      if (changed.length === 0) {
        result.unchanged += 1;
      } else if (row.updatedAt.getTime() !== row.createdAt.getTime()) {
        result.keptEdited += 1;
      } else {
        // Keeping `updated_at = created_at` marks the idea as still untouched by anyone else.
        await tx
          .update(courseIdea)
          .set({ ...idea, updatedAt: sql`${courseIdea.createdAt}` })
          .where(eq(courseIdea.id, row.id));
        result.updated += 1;
      }
    }
    if (result.inserted > 0 || result.updated > 0) {
      await audit(
        ctx,
        {
          action: "idea.import",
          targetType: "course_idea",
          meta: { inserted: result.inserted, updated: result.updated, keptEdited: result.keptEdited },
        },
        tx,
      );
    }
  });
  result.linked = await linkIdeasToCourses(ctx);
  return result;
}

/** A context for a script: the system actor, which can never approve or publish anything. */
export function scriptCtx(job: string): Ctx {
  return { db, actor: systemActor(job), now: new Date(), requestId: `script:${job}:${randomUUID()}` };
}

async function main(): Promise<void> {
  // DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
  config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
  try {
    const result = await importIdeas(scriptCtx("ideas.import"));
    console.info(
      `Course ideas: ${result.total} in the file — ${result.inserted} added, ${result.updated} updated, ${result.unchanged} unchanged, ${result.keptEdited} left alone because they were edited, ${result.linked} linked to a course.`,
    );
  } finally {
    await closeDb();
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error("Ideas import failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
