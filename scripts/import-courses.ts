/**
 * `pnpm content:import [--publish-as-seed]` — imports `content/tools`, `content/assets` and
 * `content/courses` into the database.
 *
 * DEFAULT (safe for production). Runs as the system actor, which can never approve or publish:
 * - tools are created as `pending_verification` (or `candidate`), never approved;
 * - each course is created as a hand-made draft and submitted for review. NOTHING IS PUBLISHED.
 *
 * `--publish-as-seed` is for development only and is refused unless `APP_ENV` is `local` or
 * `test`. It acts as the owner account (`OWNER_BOOTSTRAP_EMAIL`, created if missing as staff
 * `super_admin`) and uses the ordinary services, with no bypass:
 * - seed tools are approved through `approveTool`, with clearly labelled placeholders where the
 *   seed file has nulls ("DEVELOPMENT SEED — not verified against the vendor's live terms");
 * - each course gets a real review decision by the owner with the reason "Development seed", and
 *   is published through `publishVersion`, the same code path as Studio.
 *
 * Safe to run again: a tool, asset or course that has not changed is left exactly as it is, and a
 * tool or course a person has edited is never overwritten.
 *
 * Loads `.env.local` unless `DOTENV_PATH` names another file.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import type { Course } from "@/content/schema";
import { QA_CHECKLIST } from "@/content/validate";
import { env } from "@/env";
import { createAccount, normaliseEmail } from "@/server/auth/accounts";
import { audit } from "@/server/audit";
import type { StaffActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { closeDb, course, courseIdea, courseVersion, staffRole, user } from "@/server/db";
import { AppError } from "@/server/errors";
import { upsertAssetsFromManifest, type AssetUpsertResult } from "@/server/services/assets";
import { createCourse, sameContent, saveRevision } from "@/server/services/course-store";
import {
  getApprovalState,
  publishVersion,
  recordDecision,
  submitForReview,
  type ChecklistAnswer,
} from "@/server/services/publish";
import { upsertToolFromSeed, type SeedUpsertAction } from "@/server/services/tools";
import { loadContent } from "./check-content";
import { linkIdeasToCourses, scriptCtx } from "./import-ideas";

export const DEV_SEED_REASON = "Development seed";

export type CourseImportAction = "created" | "revised" | "unchanged" | "kept_edited";

export interface CourseImportOutcome {
  slug: string;
  action: CourseImportAction;
  /** The course's status when the import finished. */
  status: string;
  /** True when this run published the course (only ever with `--publish-as-seed`). */
  publishedNow: boolean;
}

export interface ContentImportResult {
  publishAsSeed: boolean;
  tools: Array<{ slug: string; action: SeedUpsertAction; devSeedApproved: boolean }>;
  assets: AssetUpsertResult;
  courses: CourseImportOutcome[];
  /** Ideas newly linked to a course with the same title. */
  ideasLinked: number;
  /** Anything that could not be imported, in plain English. An empty list means a clean run. */
  problems: string[];
}

function assertSeedEnvironment(): void {
  if (env.APP_ENV !== "local" && env.APP_ENV !== "test") {
    throw new AppError(
      "forbidden",
      `--publish-as-seed is only allowed when APP_ENV is local or test (it is "${env.APP_ENV}").`,
    );
  }
}

/**
 * The development owner account, for seeding only: finds the user with `OWNER_BOOTSTRAP_EMAIL`, or
 * creates it as staff, and makes sure it holds `super_admin`. Returns an Actor for it with the
 * second factor marked as passed, which is why this is refused outside `local` and `test`.
 */
export async function ensureSeedOwner(ctx: Ctx): Promise<StaffActor> {
  assertSeedEnvironment();
  const configured = env.OWNER_BOOTSTRAP_EMAIL;
  if (!configured)
    throw new AppError(
      "invalid_input",
      "Set OWNER_BOOTSTRAP_EMAIL so the development seed knows which account is the owner.",
    );
  const email = normaliseEmail(configured);

  let [owner] = await ctx.db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!owner) {
    const base = { kind: "staff" as const, name: "Owner", email, emailVerified: true };
    try {
      owner = await createAccount(ctx.db, { ...base, password: env.SEED_PASSWORD ?? null });
    } catch (error) {
      // A seed password the password policy refuses should not stop the seed: create the account without one.
      if (!(error instanceof AppError) || error.code !== "invalid_input" || !env.SEED_PASSWORD) throw error;
      console.warn(
        "SEED_PASSWORD does not meet the password policy, so the owner account was created without a password.",
      );
      owner = await createAccount(ctx.db, base);
    }
    await audit(ctx, {
      action: "staff.seed_owner.create",
      targetType: "user",
      targetId: owner.id,
      reason: DEV_SEED_REASON,
    });
  }
  if (owner.kind !== "staff") {
    throw new AppError(
      "conflict",
      "The account with OWNER_BOOTSTRAP_EMAIL is not a staff account, so it cannot be the seed owner.",
    );
  }
  await ctx.db.insert(staffRole).values({ userId: owner.id, role: "super_admin" }).onConflictDoNothing();
  const roles = await ctx.db
    .select({ role: staffRole.role })
    .from(staffRole)
    .where(eq(staffRole.userId, owner.id));
  return { type: "staff", userId: owner.id, roles: roles.map((row) => row.role), twoFactorVerified: true };
}

const titleKey = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, " ");

async function findIdeaId(ctx: Ctx, snapshot: Course): Promise<string | undefined> {
  if (snapshot.ideaId !== undefined) {
    const [byKey] = await ctx.db
      .select({ id: courseIdea.id })
      .from(courseIdea)
      .where(eq(courseIdea.ideaKey, snapshot.ideaId))
      .limit(1);
    if (byKey) return byKey.id;
  }
  const ideas = await ctx.db
    .select({ id: courseIdea.id, title: courseIdea.title, courseId: courseIdea.courseId })
    .from(courseIdea);
  return ideas.find((idea) => idea.courseId === null && titleKey(idea.title) === titleKey(snapshot.title))
    ?.id;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function importCourse(
  ctx: Ctx,
  snapshot: Course,
  seedOwner: StaffActor | null,
): Promise<CourseImportOutcome> {
  let action: CourseImportAction;
  const [existing] = await ctx.db.select().from(course).where(eq(course.slug, snapshot.slug)).limit(1);
  let courseId: string;
  if (!existing) {
    const created = await createCourse(ctx, snapshot, {
      origin: "hand_made",
      ideaId: await findIdeaId(ctx, snapshot),
      note: "Imported from content/courses",
    });
    courseId = created.course.id;
    action = "created";
  } else {
    courseId = existing.id;
    const [working] =
      existing.workingVersionId === null
        ? []
        : await ctx.db
            .select()
            .from(courseVersion)
            .where(eq(courseVersion.id, existing.workingVersionId))
            .limit(1);
    if (working && sameContent(working.snapshot, snapshot)) {
      action = "unchanged";
    } else if (working && working.lastEditedBy !== null && working.lastEditedBy !== seedOwner?.userId) {
      // A person has edited this course in Studio. The file never overwrites their work.
      action = "kept_edited";
    } else {
      await saveRevision(ctx, courseId, snapshot, { note: "Imported from content/courses" });
      action = "revised";
    }
  }

  const read = async () => {
    const [current] = await ctx.db.select().from(course).where(eq(course.id, courseId)).limit(1);
    if (!current || current.workingVersionId === null)
      throw new AppError("internal", `The course "${snapshot.slug}" could not be read back.`);
    const [version] = await ctx.db
      .select()
      .from(courseVersion)
      .where(eq(courseVersion.id, current.workingVersionId))
      .limit(1);
    if (!version) throw new AppError("internal", `The course "${snapshot.slug}" could not be read back.`);
    return { current, version };
  };

  let { current, version } = await read();
  if (action === "kept_edited")
    return { slug: snapshot.slug, action, status: current.status, publishedNow: false };
  if (version.status === "draft") {
    await submitForReview(ctx, courseId);
    ({ current, version } = await read());
  }
  if (seedOwner === null) return { slug: snapshot.slug, action, status: current.status, publishedNow: false };

  // Development seed only. The same services Studio uses: a real decision record, then publishVersion.
  if (current.publishedVersionId === version.id && current.status === "published") {
    return { slug: snapshot.slug, action, status: current.status, publishedNow: false };
  }
  const state = await getApprovalState(ctx, version.id);
  if (!state.evaluation.approved) {
    const checklist: Record<string, ChecklistAnswer> = Object.fromEntries(
      QA_CHECKLIST.items.map((item) => [item.key, "pass"]),
    );
    await recordDecision(ctx, version.id, {
      kind: "approve",
      checklist,
      toolClaimsChecked: true,
      reason: DEV_SEED_REASON,
      comment: "Development seed approval. This course has not been through a real review.",
      confirmedSafeguardingSoloApproval: snapshot.safeguardingSensitive,
    });
  }
  const published = await publishVersion(ctx, version.id, { reason: DEV_SEED_REASON });
  return {
    slug: snapshot.slug,
    action,
    status: published.course.status,
    publishedNow: !published.alreadyPublished,
  };
}

/**
 * Imports the content folder. `ctx` should be a system context (`scriptCtx`). With
 * `publishAsSeed` the work is done as the seed owner instead; see the file comment.
 * Shared by the CLI, the seed script and the tests.
 */
export async function importContent(
  ctx: Ctx,
  options: { rootDir?: string; publishAsSeed?: boolean } = {},
): Promise<ContentImportResult> {
  const publishAsSeed = options.publishAsSeed === true;
  if (publishAsSeed) assertSeedEnvironment();
  const seedOwner = publishAsSeed ? await ensureSeedOwner(ctx) : null;
  const actingCtx: Ctx = seedOwner ? { ...ctx, actor: seedOwner } : ctx;

  const content = loadContent(options.rootDir);
  const result: ContentImportResult = {
    publishAsSeed,
    tools: [],
    assets: { created: [], updated: [], unchanged: [] },
    courses: [],
    ideasLinked: 0,
    problems: [],
  };
  const broken = new Set<string>();
  for (const report of content.reports) {
    for (const line of report.lines) {
      if (line.severity !== "error") continue;
      broken.add(report.file);
      result.problems.push(`${report.file}: ${line.message}`);
    }
  }

  for (const { file, tool } of content.tools) {
    if (broken.has(file)) continue;
    try {
      const upserted = await upsertToolFromSeed(actingCtx, tool, { approveAsDevSeed: publishAsSeed });
      result.tools.push({
        slug: tool.slug,
        action: upserted.action,
        devSeedApproved: upserted.devSeedApproved,
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      result.problems.push(`${file}: ${message(error)}`);
    }
  }

  result.assets = await upsertAssetsFromManifest(
    actingCtx,
    content.assets.filter(({ file }) => !broken.has(file)).map(({ asset }) => asset),
  );

  for (const { file, course: snapshot } of content.courses) {
    if (broken.has(file)) continue;
    try {
      result.courses.push(await importCourse(actingCtx, snapshot, seedOwner));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const [current] = await ctx.db
        .select({ status: course.status })
        .from(course)
        .where(eq(course.slug, snapshot.slug))
        .limit(1);
      result.problems.push(`${file}: ${message(error)}`);
      if (current)
        result.courses.push({
          slug: snapshot.slug,
          action: "unchanged",
          status: current.status,
          publishedNow: false,
        });
    }
  }

  result.ideasLinked = await linkIdeasToCourses(actingCtx);
  return result;
}

export function formatImportResult(result: ContentImportResult): string {
  const count = (items: Array<{ action: string }>, action: string): number =>
    items.filter((item) => item.action === action).length;
  const lines = [
    `Content import${result.publishAsSeed ? " (DEVELOPMENT SEED: tools approved with placeholders, courses published)" : " (nothing is published)"}`,
    `Tools: ${count(result.tools, "created")} created, ${count(result.tools, "updated")} updated, ${count(result.tools, "unchanged")} unchanged, ${count(result.tools, "kept_human_record")} left as a person set them${result.publishAsSeed ? `, ${result.tools.filter((item) => item.devSeedApproved).length} approved as development seeds` : ""}.`,
    `Assets: ${result.assets.created.length} created, ${result.assets.updated.length} updated, ${result.assets.unchanged.length} unchanged.`,
    `Courses: ${count(result.courses, "created")} created, ${count(result.courses, "revised")} revised, ${count(result.courses, "unchanged")} unchanged, ${count(result.courses, "kept_edited")} left as a person edited them.`,
    ...result.courses.map(
      (item) =>
        `  ${item.slug}: ${item.action}, now ${item.status.replace(/_/g, " ")}${item.publishedNow ? " (published by this run)" : ""}`,
    ),
  ];
  if (result.ideasLinked > 0) lines.push(`Ideas linked to a course: ${result.ideasLinked}.`);
  if (result.problems.length > 0)
    lines.push("", "Problems:", ...result.problems.map((problem) => `  ${problem}`));
  return lines.join("\n");
}

async function main(argv: readonly string[]): Promise<void> {
  // DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
  config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
  const unknown = argv.filter((arg) => arg !== "--publish-as-seed");
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown.join(" ")}\nUsage: pnpm content:import [--publish-as-seed]`);
    process.exitCode = 2;
    return;
  }
  try {
    const result = await importContent(scriptCtx("content.import"), {
      publishAsSeed: argv.includes("--publish-as-seed"),
    });
    console.info(formatImportResult(result));
    process.exitCode = result.problems.length > 0 ? 1 : 0;
  } finally {
    await closeDb();
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error("Content import failed:", message(error));
    process.exit(1);
  });
}
