/**
 * Tool Register core (spec 3.3).
 *
 * The Register is the one source of truth for an external tool's facts. Courses name a tool by
 * slug only; display facts are read from here at request time and never copied into a course.
 *
 * Who may do what:
 * - a seed file or the AI engine can create and fill in `candidate` / `pending_verification`
 *   records, and can never approve one;
 * - `approveTool` is the only way a tool becomes `approved`, and only a signed-in person may call
 *   it (`tool.approve` is human-only);
 * - the under-18 policy is set by `approveTool` and `blockTool` and by nothing else.
 *
 * This module does not import `server-only`, so that the import scripts can run it with tsx.
 */
import { and, arrayContains, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { ToolSeed } from "@/content/tool-schema";
import { env } from "@/env";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, tool, toolSubstitute, type Db } from "@/server/db";
import { AppError } from "@/server/errors";

export type ToolRow = typeof tool.$inferSelect;
export type ToolStatus = ToolRow["status"];
export type Under18Policy = NonNullable<ToolRow["under18Policy"]>;

/** The note every development-seed approval carries, so it can never be mistaken for a real check. */
export const DEV_SEED_NOTE = "DEVELOPMENT SEED — not verified against the vendor's live terms";
/** Placeholder minimum age for a development-seed approval when the seed has none. */
export const DEV_SEED_MIN_AGE = 13;

// ───────────────────────────── URL allow-list ─────────────────────────────

/** Query parameter names that look like a secret. A link carrying one is never allowed (spec Section 7). */
export const SECRET_QUERY_PARAM = /pass(?:word|wd)?|pwd|secret|token|api[_-]?key|otp|one[_-]?time|session/i;

function parseHttps(value: string): URL | null {
  // Reject anything a browser would silently repair: whitespace, control characters and backslashes.
  if (value.length === 0 || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.hostname === "") return null;
  return parsed;
}

function pathWithin(path: string, prefixPath: string): boolean {
  if (prefixPath === "/" || prefixPath === "") return true;
  if (prefixPath.endsWith("/")) return path.startsWith(prefixPath);
  // `/app` allows `/app` and `/app/…`, never `/apple`.
  return path === prefixPath || path.startsWith(`${prefixPath}/`);
}

/**
 * True when `url` is an https link that sits under one of the tool's `allowed_url_prefixes`.
 *
 * The link is parsed, never compared as raw text, so `https://replit.com.evil.example`,
 * `https://replit.com@evil.example` and `https://evil.example/https://replit.com/` all fail. The
 * host and port must equal a prefix's exactly; the path must sit inside the prefix's path. A deep
 * link may carry a path, a query and a fragment, but never userinfo or a query parameter that
 * looks like a secret.
 */
export function isUrlAllowedForTool(target: Pick<ToolRow, "allowedUrlPrefixes">, url: string): boolean {
  const parsed = parseHttps(url);
  if (!parsed) return false;
  for (const name of parsed.searchParams.keys()) {
    if (SECRET_QUERY_PARAM.test(name)) return false;
  }
  return target.allowedUrlPrefixes.some((prefix) => {
    const allowed = parseHttps(prefix);
    if (!allowed) return false;
    return (
      parsed.hostname === allowed.hostname && parsed.port === allowed.port && pathWithin(parsed.pathname, allowed.pathname)
    );
  });
}

function onVendorDomain(host: string, vendorDomain: string): boolean {
  const domain = vendorDomain.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/** The same rules a seed file must meet (`src/content/tool-schema.ts`), applied to edits made in Studio. */
function assertLinksValid(fields: { vendorDomain: string | null; officialUrl: string | null; allowedUrlPrefixes: string[] }): void {
  const fieldErrors: Record<string, string[]> = {};
  const add = (key: string, message: string) => {
    fieldErrors[key] = [...(fieldErrors[key] ?? []), message];
  };
  if (fields.vendorDomain !== null && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(fields.vendorDomain)) {
    add("vendorDomain", "Use a bare domain such as example.com.");
  }
  for (const prefix of fields.allowedUrlPrefixes) {
    const parsed = parseHttps(prefix);
    if (!parsed || parsed.search !== "" || parsed.hash !== "") {
      add("allowedUrlPrefixes", `"${prefix}" is not a plain https:// address.`);
      continue;
    }
    if (parsed.pathname === "/" && !prefix.endsWith("/")) {
      add("allowedUrlPrefixes", `End "${prefix}" with "/" so it cannot match another domain.`);
    }
    if (fields.vendorDomain !== null && !onVendorDomain(parsed.hostname, fields.vendorDomain)) {
      add("allowedUrlPrefixes", `"${prefix}" is not on the vendor domain ${fields.vendorDomain}.`);
    }
  }
  if (fields.officialUrl !== null) {
    if (!parseHttps(fields.officialUrl)) {
      add("officialUrl", "Use a full https:// address.");
    } else if (fields.allowedUrlPrefixes.length > 0 && !isUrlAllowedForTool(fields, fields.officialUrl)) {
      add("officialUrl", "The official link must start with one of the allowed link prefixes.");
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError("invalid_input", "Some of the tool's links are not valid. Check them and try again.", { fieldErrors });
  }
}

// ───────────────────────────── Reading ─────────────────────────────

/**
 * One tool by slug, or null. No authorisation check: the Register's facts are shown to learners and
 * parents ("Tools you'll need"). Pass the row through `toolViewForLearners` before showing it.
 */
export async function getToolBySlug(ctx: Pick<Ctx, "db">, slug: string): Promise<ToolRow | null> {
  const [row] = await ctx.db.select().from(tool).where(eq(tool.slug, slug)).limit(1);
  return row ?? null;
}

/** Tools by slug. Unknown slugs are simply absent from the map. */
export async function getToolsBySlugs(ctx: Pick<Ctx, "db">, slugs: readonly string[]): Promise<Map<string, ToolRow>> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return new Map();
  const rows = await ctx.db.select().from(tool).where(inArray(tool.slug, unique));
  return new Map(rows.map((row) => [row.slug, row]));
}

export interface ToolFilters {
  status?: ToolStatus | readonly ToolStatus[];
  under18Policy?: Under18Policy | "unset";
  /** Matches name, slug or vendor domain. */
  search?: string;
  limit?: number;
  offset?: number;
}

/** The Register list for Studio (`tool.read`). */
export async function listTools(ctx: Ctx, filters: ToolFilters = {}): Promise<ToolRow[]> {
  assertCan(ctx.actor, "tool.read");
  const where: SQL[] = [];
  if (filters.status !== undefined) {
    const statuses = typeof filters.status === "string" ? [filters.status] : [...filters.status];
    if (statuses.length > 0) where.push(inArray(tool.status, statuses));
  }
  if (filters.under18Policy === "unset") where.push(sql`${tool.under18Policy} IS NULL`);
  else if (filters.under18Policy !== undefined) where.push(eq(tool.under18Policy, filters.under18Policy));
  const term = filters.search?.trim();
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const matches = or(ilike(tool.name, like), ilike(tool.slug, like), ilike(tool.vendorDomain, like));
    if (matches) where.push(matches);
  }
  return ctx.db
    .select()
    .from(tool)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(tool.name), asc(tool.slug))
    .limit(Math.min(Math.max(filters.limit ?? 200, 1), 500))
    .offset(Math.max(filters.offset ?? 0, 0));
}

export interface LearnerToolView {
  slug: string;
  name: string;
  officialUrl: string | null;
  /** What a parent would pay, in the Register's words. */
  cost: string | null;
  freeTier: string | null;
  /** Minimum age under the vendor's terms. */
  minAge: number | null;
  under18Policy: Exclude<Under18Policy, "blocked">;
  /** A parent must approve this tool for the course before the learner can start. */
  parentMustApprove: boolean;
  /** A parent must create and run the account: the learner sees "Ask a parent to set this up". */
  parentMustSetUp: boolean;
  /** Link to the course's setup guide for this tool, passed in by the caller. */
  guideHref: string | null;
  lastCheckedAt: Date | null;
}

/**
 * What a learner or parent may see about a tool ("Tools you'll need"). Returns null unless the tool
 * is approved with a usable under-18 policy and its official link passes its own allow-list, so an
 * unverified or blocked tool is never shown as usable. Build this at request time from a fresh
 * Register row; never store the result in a course.
 */
export function toolViewForLearners(row: ToolRow, options: { guideHref?: string | null } = {}): LearnerToolView | null {
  if (row.status !== "approved") return null;
  if (row.under18Policy === null || row.under18Policy === "blocked") return null;
  const officialUrl = row.officialUrl !== null && isUrlAllowedForTool(row, row.officialUrl) ? row.officialUrl : null;
  return {
    slug: row.slug,
    name: row.name,
    officialUrl,
    cost: row.cost,
    freeTier: row.freeTier,
    minAge: row.minAge,
    under18Policy: row.under18Policy,
    parentMustApprove: row.under18Policy === "parent_consent_required" || row.under18Policy === "parent_operated",
    parentMustSetUp: row.under18Policy === "parent_operated",
    guideHref: options.guideHref ?? null,
    lastCheckedAt: row.lastCheckedAt,
  };
}

// ───────────────────────────── Helpers ─────────────────────────────

async function requireTool(db: Db, slug: string, lock = false): Promise<ToolRow> {
  const query = db.select().from(tool).where(eq(tool.slug, slug)).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new AppError("not_found", `The tool "${slug}" is not in the Tool Register.`);
  return row;
}

function one<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new AppError("internal", "Something went wrong saving that. Please try again.", { detail: { what } });
  return row;
}

const staffUserId = (ctx: Ctx): string | null => (ctx.actor.type === "staff" ? ctx.actor.userId : null);

/** Ids of courses whose live version requires the tool, so a caller can flag them for review. */
export async function coursesUsingTool(ctx: Pick<Ctx, "db">, slug: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: course.id })
    .from(course)
    .where(and(arrayContains(course.toolSlugs, [slug]), inArray(course.status, ["published", "needs_review"])));
  return rows.map((row) => row.id);
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ───────────────────────────── Seeds and candidates ─────────────────────────────

export type SeedUpsertAction = "created" | "updated" | "unchanged" | "kept_human_record";

export interface SeedUpsertResult {
  tool: ToolRow;
  action: SeedUpsertAction;
  /** True when this call approved the tool as a development seed. */
  devSeedApproved: boolean;
}

function seedFields(seed: ToolSeed) {
  return {
    name: seed.name,
    vendorDomain: seed.vendorDomain,
    officialUrl: seed.officialUrl,
    allowedUrlPrefixes: seed.allowedUrlPrefixes,
    cost: seed.cost.paidNote,
    freeTier: seed.cost.freeTier,
    minAge: seed.minAge,
    consentRule: seed.consentRule,
    notes: seed.notes,
    evidence: seed.evidence as unknown[],
    // A seed file never approves a tool, whatever it says about itself.
    status: seed.seedStatus === "candidate" ? ("candidate" as const) : ("pending_verification" as const),
  };
}

/**
 * Creates or refreshes a Register record from `content/tools/<slug>.json`.
 *
 * A seed can only create a record, or update one that nothing else has touched since it was
 * created (`updated_at = created_at`, which this function preserves on its own updates). A record
 * a person has approved, blocked, retired or edited is left exactly as it is. The seed's
 * `under18Policy` is never written: only `approveTool` sets a policy.
 *
 * `approveAsDevSeed` is for `pnpm content:import --publish-as-seed`. It is refused unless
 * `APP_ENV` is `local` or `test`, and it goes through `approveTool`, so `ctx` must be a signed-in
 * person who may approve tools. Nulls in the seed are filled with placeholders and the notes say
 * so in capitals.
 */
export async function upsertToolFromSeed(
  ctx: Ctx,
  seed: ToolSeed,
  options: { approveAsDevSeed?: boolean } = {},
): Promise<SeedUpsertResult> {
  assertCan(ctx.actor, "tool.edit");
  if (options.approveAsDevSeed) assertDevSeedAllowed();
  const fields = seedFields(seed);

  const upserted = await ctx.db.transaction(async (tx): Promise<{ tool: ToolRow; action: SeedUpsertAction }> => {
    const [existing] = await tx.select().from(tool).where(eq(tool.slug, seed.slug)).limit(1).for("update");
    if (!existing) {
      const created = one(await tx.insert(tool).values({ slug: seed.slug, ...fields }).returning(), "tool");
      await audit(ctx, { action: "tool.seed.create", targetType: "tool", targetId: created.id, meta: { slug: seed.slug, status: created.status } }, tx);
      return { tool: created, action: "created" };
    }
    const pristine = existing.updatedAt.getTime() === existing.createdAt.getTime();
    const seedOwned = existing.status === "candidate" || existing.status === "pending_verification";
    if (!pristine || !seedOwned || existing.verifiedBy !== null || existing.under18Policy !== null) {
      return { tool: existing, action: "kept_human_record" };
    }
    const changed = (Object.keys(fields) as Array<keyof typeof fields>).filter((key) => !sameJson(existing[key], fields[key]));
    if (changed.length === 0) return { tool: existing, action: "unchanged" };
    const updated = one(
      await tx
        .update(tool)
        // Keeping `updated_at = created_at` marks the record as still owned by the seed.
        .set({ ...fields, updatedAt: sql`${tool.createdAt}` })
        .where(eq(tool.id, existing.id))
        .returning(),
      "tool",
    );
    await audit(ctx, { action: "tool.seed.update", targetType: "tool", targetId: updated.id, meta: { slug: seed.slug, changed } }, tx);
    return { tool: updated, action: "updated" };
  });

  if (!options.approveAsDevSeed) return { ...upserted, devSeedApproved: false };
  // Never touch a tool a person has already decided on.
  if (upserted.tool.status !== "candidate" && upserted.tool.status !== "pending_verification") {
    return { ...upserted, devSeedApproved: false };
  }
  const placeholders: string[] = [];
  if (seed.under18Policy === null) placeholders.push('under-18 policy "allowed"');
  if (seed.minAge === null) placeholders.push(`minimum age ${DEV_SEED_MIN_AGE}`);
  const policy = seed.under18Policy === null || seed.under18Policy === "blocked" ? "allowed" : seed.under18Policy;
  if (seed.under18Policy === "blocked") placeholders.push('under-18 policy "allowed" (the seed says blocked)');
  const approved = await approveTool(ctx, seed.slug, {
    under18Policy: policy,
    minAge: seed.minAge ?? DEV_SEED_MIN_AGE,
    evidenceChecked: true,
    parentOperatedAllowed: policy === "parent_operated" ? true : undefined,
    note: `${DEV_SEED_NOTE}.${placeholders.length > 0 ? ` Placeholders: ${placeholders.join(", ")}.` : ""}`,
    devSeed: true,
  });
  return { tool: approved, action: upserted.action, devSeedApproved: true };
}

function assertDevSeedAllowed(): void {
  if (env.APP_ENV !== "local" && env.APP_ENV !== "test") {
    throw new AppError("forbidden", "Development seed approval is only allowed in a local or test environment.", {
      detail: { appEnv: env.APP_ENV },
    });
  }
}

export interface CandidateToolInput {
  name: string;
  vendorDomain: string;
  /** Lower-case words joined by hyphens. Worked out from the name when left out. */
  slug?: string;
  officialUrl?: string;
  notes?: string;
  /** Quoted evidence with URLs: `[{ claim, quote, url }]`. */
  evidence?: unknown[];
  /** Pages for `tools.watch`: `[{ kind, url }]`. */
  watchPages?: unknown[];
  sourceCandidateId?: string;
}

const slugify = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * Adds a tool the AI engine or an editor has found. The record is always a `candidate` with no
 * minimum age and no under-18 policy: those are never guessed, and a person must complete and
 * approve the Register fields before any course that uses the tool can go live (spec 3.3, 3.9).
 * If a tool with the same slug or vendor domain already exists it is returned untouched.
 */
export async function createCandidateTool(ctx: Ctx, input: CandidateToolInput): Promise<{ tool: ToolRow; created: boolean }> {
  assertCan(ctx.actor, "tool.edit");
  const name = input.name.trim();
  const vendorDomain = input.vendorDomain.trim().toLowerCase();
  const baseSlug = slugify(input.slug ?? name);
  if (name === "" || baseSlug === "") throw new AppError("invalid_input", "A tool needs a name.");

  let officialUrl: string | null = null;
  let allowedUrlPrefixes: string[] = [];
  if (input.officialUrl !== undefined) {
    const parsed = parseHttps(input.officialUrl);
    if (parsed && onVendorDomain(parsed.hostname, vendorDomain)) {
      officialUrl = parsed.toString();
      allowedUrlPrefixes = [`${parsed.origin}/`];
    }
  }
  assertLinksValid({ vendorDomain, officialUrl, allowedUrlPrefixes });

  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(tool)
      .where(or(eq(tool.slug, baseSlug), eq(tool.vendorDomain, vendorDomain)))
      .orderBy(asc(tool.createdAt))
      .limit(1);
    if (existing) return { tool: existing, created: false };
    const created = one(
      await tx
        .insert(tool)
        .values({
          slug: baseSlug,
          name,
          vendorDomain,
          officialUrl,
          allowedUrlPrefixes,
          notes: input.notes ?? null,
          evidence: input.evidence ?? [],
          watchPages: input.watchPages ?? [],
          sourceCandidateId: input.sourceCandidateId ?? null,
          status: "candidate",
        })
        .returning(),
      "tool",
    );
    await audit(ctx, { action: "tool.candidate.create", targetType: "tool", targetId: created.id, meta: { slug: created.slug, vendorDomain } }, tx);
    return { tool: created, created: true };
  });
}

// ───────────────────────────── Editing ─────────────────────────────

export interface ToolPatch {
  name?: string;
  notes?: string | null;
  watchPages?: unknown[];
  // Term-related: changing any of these sends an approved tool back for verification.
  vendorDomain?: string | null;
  officialUrl?: string | null;
  allowedUrlPrefixes?: string[];
  cost?: string | null;
  freeTier?: string | null;
  minAge?: number | null;
  consentRule?: string | null;
  evidence?: unknown[];
}

/** Fields a reviewer verified. A change to one of them means the approval no longer describes the record. */
export const TERM_RELATED_TOOL_FIELDS = [
  "vendorDomain",
  "officialUrl",
  "allowedUrlPrefixes",
  "cost",
  "freeTier",
  "minAge",
  "consentRule",
  "evidence",
] as const satisfies ReadonlyArray<keyof ToolPatch>;

export interface ToolChangeResult {
  tool: ToolRow;
  /** True when the change took the tool out of `approved`. */
  verificationReset: boolean;
  /** Live courses that require this tool. Flag them with `markNeedsReview` when the tool stopped being usable. */
  affectedCourseIds: string[];
}

/**
 * Edits Register fields (`tool.edit`). The under-18 policy is not editable here: it is set by
 * `approveTool` and `blockTool` only.
 *
 * Changing any term-related field on an approved tool resets it to `pending_verification`, clears
 * who verified it and when, and clears the under-18 policy (never treated as "allowed" while
 * unset), so a person must look again. A blocked or retired tool stays blocked or retired.
 */
export async function updateToolFields(ctx: Ctx, slug: string, patch: ToolPatch): Promise<ToolChangeResult> {
  assertCan(ctx.actor, "tool.edit");
  return ctx.db.transaction(async (tx) => {
    const existing = await requireTool(tx, slug, true);
    const changed = (Object.keys(patch) as Array<keyof ToolPatch>).filter(
      (key) => patch[key] !== undefined && !sameJson(existing[key], patch[key]),
    );
    if (changed.length === 0) return { tool: existing, verificationReset: false, affectedCourseIds: [] };

    const set: Partial<typeof tool.$inferInsert> = {};
    if (patch.name !== undefined) {
      if (patch.name.trim() === "") throw new AppError("invalid_input", "A tool needs a name.");
      set.name = patch.name.trim();
    }
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.watchPages !== undefined) set.watchPages = patch.watchPages;
    if (patch.vendorDomain !== undefined) set.vendorDomain = patch.vendorDomain?.trim().toLowerCase() ?? null;
    if (patch.officialUrl !== undefined) set.officialUrl = patch.officialUrl;
    if (patch.allowedUrlPrefixes !== undefined) set.allowedUrlPrefixes = patch.allowedUrlPrefixes;
    if (patch.cost !== undefined) set.cost = patch.cost;
    if (patch.freeTier !== undefined) set.freeTier = patch.freeTier;
    if (patch.consentRule !== undefined) set.consentRule = patch.consentRule;
    if (patch.evidence !== undefined) set.evidence = patch.evidence;
    if (patch.minAge !== undefined) {
      if (patch.minAge !== null && (!Number.isInteger(patch.minAge) || patch.minAge < 0 || patch.minAge > 21)) {
        throw new AppError("invalid_input", "The minimum age must be a whole number from 0 to 21.");
      }
      set.minAge = patch.minAge;
    }
    assertLinksValid({
      vendorDomain: set.vendorDomain !== undefined ? set.vendorDomain : existing.vendorDomain,
      officialUrl: set.officialUrl !== undefined ? set.officialUrl : existing.officialUrl,
      allowedUrlPrefixes: set.allowedUrlPrefixes ?? existing.allowedUrlPrefixes,
    });

    const termChanged = changed.some((key) => (TERM_RELATED_TOOL_FIELDS as readonly string[]).includes(key));
    const verificationReset = termChanged && existing.status === "approved";
    if (termChanged && (existing.status === "approved" || existing.status === "pending_verification")) {
      set.status = "pending_verification";
      set.verifiedBy = null;
      set.verifiedAt = null;
      set.under18Policy = null;
      set.parentOperatedAllowedRecordedBy = null;
      set.parentOperatedAllowedRecordedAt = null;
    }

    const updated = one(await tx.update(tool).set(set).where(eq(tool.id, existing.id)).returning(), "tool");
    await audit(
      ctx,
      {
        action: "tool.update",
        targetType: "tool",
        targetId: updated.id,
        meta: { slug, changed, verificationReset, statusFrom: existing.status, statusTo: updated.status },
      },
      tx,
    );
    return {
      tool: updated,
      verificationReset,
      affectedCourseIds: verificationReset ? await coursesUsingTool({ db: tx }, slug) : [],
    };
  });
}

export interface ApproveToolInput {
  under18Policy: Exclude<Under18Policy, "blocked">;
  /** Minimum age under the vendor's terms, as the approver read them. */
  minAge: number;
  /** The approver confirms they checked the recorded evidence against the vendor's live pages. */
  evidenceChecked: true;
  /** Required for `parent_operated`: the approver records that the vendor allows a parent-operated account. */
  parentOperatedAllowed?: boolean;
  /** Stored at the top of the tool's notes. */
  note?: string;
  /** Set only by `upsertToolFromSeed({ approveAsDevSeed: true })`. Refused outside local and test. */
  devSeed?: boolean;
}

/**
 * Approves a tool for use by learners (`tool.approve`, human only: the system actor is refused).
 *
 * - The approver must confirm the evidence was checked.
 * - `parent_operated` needs `parentOperatedAllowed: true`, which is recorded with the approver's
 *   name and the time (spec 3.3).
 * - A tool whose terms are 18+ can only be `parent_operated` (or blocked with `blockTool`).
 * - The record must be complete: an official link that passes the tool's own allow-list.
 */
export async function approveTool(ctx: Ctx, slug: string, input: ApproveToolInput): Promise<ToolRow> {
  assertCan(ctx.actor, "tool.approve");
  if (ctx.actor.type !== "staff") throw new AppError("forbidden", "Only a signed-in member of staff can approve a tool.");
  const approverId = ctx.actor.userId;
  if (input.devSeed) assertDevSeedAllowed();
  if (input.evidenceChecked !== true) {
    throw new AppError("invalid_input", "Confirm that you checked the evidence against the vendor's live pages before approving.");
  }
  const policy: string = input.under18Policy;
  if (policy !== "allowed" && policy !== "parent_consent_required" && policy !== "parent_operated") {
    throw new AppError("invalid_input", "Choose an under-18 policy. To block a tool, use Block instead of Approve.");
  }
  if (!Number.isInteger(input.minAge) || input.minAge < 0 || input.minAge > 21) {
    throw new AppError("invalid_input", "The minimum age must be a whole number from 0 to 21.");
  }
  if (input.under18Policy === "parent_operated" && input.parentOperatedAllowed !== true) {
    throw new AppError(
      "invalid_input",
      "A parent-operated tool can only be approved once you have recorded that the vendor allows a parent to run the account.",
    );
  }
  if (input.minAge >= 18 && input.under18Policy !== "parent_operated") {
    throw new AppError(
      "invalid_input",
      "This tool's terms are 18+. It can only be approved as parent-operated, or blocked.",
    );
  }

  return ctx.db.transaction(async (tx) => {
    const existing = await requireTool(tx, slug, true);
    if (existing.officialUrl === null || existing.allowedUrlPrefixes.length === 0) {
      throw new AppError("validation_failed", "Add the tool's official link and allowed link prefixes before approving it.");
    }
    if (!isUrlAllowedForTool(existing, existing.officialUrl)) {
      throw new AppError("validation_failed", "The tool's official link does not start with one of its allowed link prefixes.");
    }
    const parentOperated = input.under18Policy === "parent_operated";
    const note = input.note?.trim();
    const notes = note ? (existing.notes?.includes(note) ? existing.notes : [note, existing.notes].filter(Boolean).join("\n\n")) : existing.notes;
    const updated = one(
      await tx
        .update(tool)
        .set({
          status: "approved",
          under18Policy: input.under18Policy,
          minAge: input.minAge,
          parentOperatedAllowedRecordedBy: parentOperated ? approverId : null,
          parentOperatedAllowedRecordedAt: parentOperated ? ctx.now : null,
          lastCheckedAt: ctx.now,
          verifiedBy: approverId,
          verifiedAt: ctx.now,
          notes,
        })
        .where(eq(tool.id, existing.id))
        .returning(),
      "tool",
    );
    await audit(
      ctx,
      {
        action: "tool.approve",
        targetType: "tool",
        targetId: updated.id,
        reason: input.devSeed ? "Development seed" : undefined,
        meta: {
          slug,
          statusFrom: existing.status,
          under18PolicyFrom: existing.under18Policy,
          under18Policy: input.under18Policy,
          minAge: input.minAge,
          parentOperatedAllowed: parentOperated,
          evidenceChecked: true,
          devSeed: input.devSeed === true,
        },
      },
      tx,
    );
    return updated;
  });
}

/**
 * Blocks a tool for learners at once (`tool.edit`; a job may do this too, because blocking is the
 * safe direction). Sets both the status and the under-18 policy to `blocked`. Only `approveTool`,
 * by a person, can bring the tool back.
 */
export async function blockTool(ctx: Ctx, slug: string, reason: string): Promise<ToolChangeResult> {
  assertCan(ctx.actor, "tool.edit");
  if (reason.trim() === "") throw new AppError("invalid_input", "Say why the tool is being blocked.");
  return ctx.db.transaction(async (tx) => {
    const existing = await requireTool(tx, slug, true);
    const affectedCourseIds = await coursesUsingTool({ db: tx }, slug);
    if (existing.status === "blocked" && existing.under18Policy === "blocked") {
      return { tool: existing, verificationReset: false, affectedCourseIds };
    }
    const updated = one(
      await tx
        .update(tool)
        .set({
          status: "blocked",
          under18Policy: "blocked",
          parentOperatedAllowedRecordedBy: null,
          parentOperatedAllowedRecordedAt: null,
          lastCheckedAt: ctx.now,
        })
        .where(eq(tool.id, existing.id))
        .returning(),
      "tool",
    );
    await audit(
      ctx,
      {
        action: "tool.block",
        targetType: "tool",
        targetId: updated.id,
        reason: reason.trim(),
        meta: { slug, statusFrom: existing.status, under18PolicyFrom: existing.under18Policy, by: staffUserId(ctx) },
      },
      tx,
    );
    return { tool: updated, verificationReset: existing.status === "approved", affectedCourseIds };
  });
}

/** Records that `substituteSlug` can stand in for `slug` (`tool.edit`). Running it twice changes nothing. */
export async function addSubstitute(
  ctx: Ctx,
  slug: string,
  substituteSlug: string,
  note?: string,
): Promise<typeof toolSubstitute.$inferSelect> {
  assertCan(ctx.actor, "tool.edit");
  if (slug === substituteSlug) throw new AppError("invalid_input", "A tool cannot be its own substitute.");
  return ctx.db.transaction(async (tx) => {
    const main = await requireTool(tx, slug, true);
    const substitute = await requireTool(tx, substituteSlug);
    const [existing] = await tx
      .select()
      .from(toolSubstitute)
      .where(and(eq(toolSubstitute.toolId, main.id), eq(toolSubstitute.substituteToolId, substitute.id)))
      .limit(1);
    if (existing) return existing;
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(toolSubstitute)
      .where(eq(toolSubstitute.toolId, main.id));
    const created = one(
      await tx
        .insert(toolSubstitute)
        .values({ toolId: main.id, substituteToolId: substitute.id, note: note ?? null, position: count })
        .returning(),
      "tool_substitute",
    );
    await audit(ctx, { action: "tool.substitute.add", targetType: "tool", targetId: main.id, meta: { slug, substituteSlug } }, tx);
    return created;
  });
}
