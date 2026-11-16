import { and, eq, inArray, sql } from "drizzle-orm";
import { env } from "@/env";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { aiProcessor, course, courseTool, page, pageVersion, siteSetting, tool } from "@/server/db";
import { AppError } from "@/server/errors";
import { LAUNCH_READINESS_ITEMS, type LaunchReadinessKey } from "./registry";
import { getSetting } from "./store";

/**
 * The launch-readiness checklist (decision D2, spec 3.10).
 *
 * Public sign-up cannot open, and closes itself again, unless every item here is satisfied.
 * Four items are worked out from the data (`auto`); four are a named person's confirmation,
 * recorded with who and when in the `launch.readiness` setting. There is no environment switch
 * that skips the checklist: development and tests satisfy it with `markLaunchReadyForDev`.
 */

/** Legal pages that must be published before sign-up opens. Slugs are those of `page.slug`. */
export const REQUIRED_LEGAL_SLUGS = [
  "privacy",
  "privacy-teen",
  "terms",
  "cookies",
  "community-code",
  "ai-use-policy",
] as const;

/**
 * Providers that are processors but are switched on by environment variable rather than in
 * Studio → AI. When one is selected it needs an approved, enabled `ai_processor` row under
 * this key, the same as a model provider (docs/ARCHITECTURE.md "Providers behind adapters").
 */
export function requiredProcessorKeysFromEnv(): string[] {
  const keys: string[] = [];
  if (env.EMAIL_PROVIDER !== "console") keys.push(`email.${env.EMAIL_PROVIDER}`);
  if (env.STORAGE_PROVIDER === "s3") keys.push("storage.s3");
  return keys;
}

export type LaunchConfirmation = { confirmedBy: string; confirmedAt: string; note?: string };

export type LaunchReadinessItem = {
  key: LaunchReadinessKey;
  label: string;
  /** True when the item is worked out from data; false when a person confirms it. */
  auto: boolean;
  satisfied: boolean;
  /** One plain sentence: why it passes, or what is still missing. */
  detail: string;
  confirmedBy?: string;
  confirmedAt?: string;
};

export type LaunchReadiness = {
  ready: boolean;
  items: LaunchReadinessItem[];
  outstanding: LaunchReadinessItem[];
};

/** Everything the checklist looks at. Tests pass these in directly; `loadReadinessInputs` reads them from the database. */
export type ReadinessInputs = {
  dslName: string | null;
  aiProviderMode: "fixture" | "gateway";
  processors: Array<{
    providerKey: string;
    enabled: boolean;
    approvedAt: Date | null;
    dpaReference: string | null;
  }>;
  /** Extra provider keys that must be approved and enabled (email, storage). */
  requiredProcessorKeys: string[];
  /** Slugs of `legal` pages whose current version is published. */
  publishedLegalSlugs: string[];
  /** Every tool listed by the published version of a published course, including fallbacks. */
  publishedCourseTools: Array<{ slug: string; status: string; under18Policy: string | null }>;
  confirmations: Record<string, LaunchConfirmation>;
};

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;
const list = (items: string[]) => items.join(", ");

function isApproved(p: ReadinessInputs["processors"][number]): boolean {
  return p.approvedAt !== null && hasText(p.dpaReference);
}

type AutoResult = { satisfied: boolean; detail: string };

const AUTO_CHECKS: Record<string, (inputs: ReadinessInputs) => AutoResult> = {
  dsl_named: (inputs) =>
    hasText(inputs.dslName)
      ? { satisfied: true, detail: "A Designated Safeguarding Lead is named in Settings." }
      : { satisfied: false, detail: "Name the Designated Safeguarding Lead in Settings → Safeguarding." },

  processors_approved: (inputs) => {
    const enabled = inputs.processors.filter((p) => p.enabled);
    const unapproved = enabled.filter((p) => !isApproved(p)).map((p) => p.providerKey);
    if (unapproved.length > 0) {
      return {
        satisfied: false,
        detail: `Enabled without an approval and DPA reference: ${list(unapproved)}.`,
      };
    }
    const usable = new Set(enabled.map((p) => p.providerKey));
    const missing = inputs.requiredProcessorKeys.filter((key) => !usable.has(key));
    if (missing.length > 0) {
      return {
        satisfied: false,
        detail: `Selected by configuration but not approved and enabled in Studio → AI: ${list(missing)}.`,
      };
    }
    // Email and storage rows do not count: live AI needs a model provider of its own.
    const modelProviders = enabled.filter((p) => !inputs.requiredProcessorKeys.includes(p.providerKey));
    if (inputs.aiProviderMode === "gateway" && modelProviders.length === 0) {
      return {
        satisfied: false,
        detail: "Live AI is switched on, but no model provider is approved and enabled.",
      };
    }
    return {
      satisfied: true,
      detail:
        enabled.length === 0
          ? "No external provider is enabled."
          : `${enabled.length} enabled, each with an approval and a DPA reference.`,
    };
  },

  legal_pages_published: (inputs) => {
    const published = new Set(inputs.publishedLegalSlugs);
    const missing = REQUIRED_LEGAL_SLUGS.filter((slug) => !published.has(slug));
    return missing.length === 0
      ? { satisfied: true, detail: "All six legal pages are published." }
      : { satisfied: false, detail: `Not yet published: ${list(missing)}.` };
  },

  tools_verified: (inputs) => {
    const problems = inputs.publishedCourseTools
      .filter((t) => t.status !== "approved" || t.under18Policy === null)
      .map((t) => t.slug);
    const unique = [...new Set(problems)].sort();
    if (unique.length > 0)
      return {
        satisfied: false,
        detail: `Used by a published course but not verified in the Tool Register: ${list(unique)}.`,
      };
    return {
      satisfied: true,
      detail:
        inputs.publishedCourseTools.length === 0
          ? "No published course uses a tool yet."
          : "Every tool used by a published course is approved with an under-18 policy.",
    };
  },
};

/** Pure: turns the inputs into the checklist. No database, no clock. */
export function evaluateLaunchReadiness(inputs: ReadinessInputs): LaunchReadiness {
  const items = LAUNCH_READINESS_ITEMS.map((item): LaunchReadinessItem => {
    if (item.auto) {
      const check = AUTO_CHECKS[item.key];
      // An automatic item with no check is a programming mistake. Fail closed.
      const result = check ? check(inputs) : { satisfied: false, detail: "This check is not implemented." };
      return { key: item.key, label: item.label, auto: true, ...result };
    }
    const confirmation = inputs.confirmations[item.key];
    if (confirmation && hasText(confirmation.confirmedBy) && hasText(confirmation.confirmedAt)) {
      return {
        key: item.key,
        label: item.label,
        auto: false,
        satisfied: true,
        detail: hasText(confirmation.note) ? confirmation.note : "Confirmed.",
        confirmedBy: confirmation.confirmedBy,
        confirmedAt: confirmation.confirmedAt,
      };
    }
    return {
      key: item.key,
      label: item.label,
      auto: false,
      satisfied: false,
      detail: "Waiting for the owner to confirm.",
    };
  });
  const outstanding = items.filter((i) => !i.satisfied);
  return { ready: outstanding.length === 0, items, outstanding };
}

export async function loadReadinessInputs(ctx: Pick<Ctx, "db">): Promise<ReadinessInputs> {
  const [dslName, confirmations, processors, legal, primaryTools, fallbackTools] = await Promise.all([
    getSetting(ctx, "safeguarding.dsl_name"),
    getSetting(ctx, "launch.readiness"),
    ctx.db
      .select({
        providerKey: aiProcessor.providerKey,
        enabled: aiProcessor.enabled,
        approvedAt: aiProcessor.approvedAt,
        dpaReference: aiProcessor.dpaReference,
      })
      .from(aiProcessor),
    ctx.db
      .select({ slug: page.slug })
      .from(page)
      .innerJoin(pageVersion, eq(pageVersion.id, page.currentVersionId))
      .where(
        and(
          eq(page.kind, "legal"),
          eq(pageVersion.status, "published"),
          inArray(page.slug, [...REQUIRED_LEGAL_SLUGS]),
        ),
      ),
    ctx.db
      .select({ slug: tool.slug, status: tool.status, under18Policy: tool.under18Policy })
      .from(courseTool)
      .innerJoin(
        course,
        and(eq(course.id, courseTool.courseId), eq(course.publishedVersionId, courseTool.courseVersionId)),
      )
      .innerJoin(tool, eq(tool.id, courseTool.toolId))
      .where(eq(course.status, "published")),
    ctx.db
      .select({ slug: tool.slug, status: tool.status, under18Policy: tool.under18Policy })
      .from(courseTool)
      .innerJoin(
        course,
        and(eq(course.id, courseTool.courseId), eq(course.publishedVersionId, courseTool.courseVersionId)),
      )
      .innerJoin(tool, eq(tool.id, courseTool.fallbackToolId))
      .where(eq(course.status, "published")),
  ]);
  return {
    dslName,
    aiProviderMode: env.AI_PROVIDER_MODE,
    processors,
    requiredProcessorKeys: requiredProcessorKeysFromEnv(),
    publishedLegalSlugs: legal.map((l) => l.slug),
    publishedCourseTools: [...primaryTools, ...fallbackTools],
    confirmations,
  };
}

/** The checklist with no permission check: for the sign-up gate and the settings guard. Never send it to a browser. */
export async function computeLaunchReadiness(ctx: Pick<Ctx, "db">): Promise<LaunchReadiness> {
  return evaluateLaunchReadiness(await loadReadinessInputs(ctx));
}

/** The checklist for Studio → Launch readiness. Staff with `setting.manage`. */
export async function getLaunchReadiness(ctx: Ctx): Promise<LaunchReadinessItem[]> {
  assertCan(ctx.actor, "setting.manage");
  return (await computeLaunchReadiness(ctx)).items;
}

function manualItem(key: string) {
  const item = LAUNCH_READINESS_ITEMS.find((i) => i.key === key);
  if (!item) throw new AppError("not_found", "That checklist item doesn't exist.");
  if (item.auto) {
    throw new AppError(
      "invalid_input",
      `"${item.label}" is checked automatically, so it can't be confirmed or cleared by hand.`,
    );
  }
  return item;
}

/** Owner only. Records that a manual item is done, with a note saying on what evidence. */
export async function confirmLaunchItem(ctx: Ctx, key: LaunchReadinessKey, note: string): Promise<void> {
  assertCan(ctx.actor, "launch_readiness.manage");
  // `launch_readiness.manage` is human-only, so this is always a member of staff.
  if (ctx.actor.type !== "staff")
    throw new AppError("forbidden", "Only the owner can confirm a launch-readiness item.");
  const item = manualItem(key);
  const trimmed = note.trim();
  if (trimmed.length < 3) {
    throw new AppError(
      "invalid_input",
      "Add a short note saying who signed this off or where the evidence is kept.",
    );
  }
  const entry: LaunchConfirmation = {
    confirmedBy: ctx.actor.userId,
    confirmedAt: ctx.now.toISOString(),
    note: trimmed.slice(0, 500),
  };
  const patch = JSON.stringify({ [item.key]: entry });
  const updatedBy = ctx.actor.userId;
  await ctx.db.transaction(async (tx) => {
    // One statement merges the entry into the stored object, so two confirmations cannot overwrite each other.
    await tx
      .insert(siteSetting)
      .values({ key: "launch.readiness", value: { [item.key]: entry }, updatedBy, updatedAt: ctx.now })
      .onConflictDoUpdate({
        target: siteSetting.key,
        set: {
          value: sql`(CASE WHEN jsonb_typeof(${siteSetting.value}) = 'object' THEN ${siteSetting.value} ELSE '{}'::jsonb END) || ${patch}::jsonb`,
          updatedBy,
          updatedAt: ctx.now,
        },
      });
    await audit(
      ctx,
      {
        action: "launch_readiness.confirm",
        targetType: "launch_readiness",
        targetId: item.key,
        meta: { note: entry.note },
      },
      tx,
    );
  });
}

/** Owner only. Withdraws a confirmation. Sign-up closes itself until the item is confirmed again. */
export async function clearLaunchItem(ctx: Ctx, key: LaunchReadinessKey, reason: string): Promise<void> {
  assertCan(ctx.actor, "launch_readiness.manage");
  if (ctx.actor.type !== "staff")
    throw new AppError("forbidden", "Only the owner can change a launch-readiness item.");
  const item = manualItem(key);
  const trimmed = reason.trim();
  if (trimmed.length < 3)
    throw new AppError("invalid_input", "Say briefly why this confirmation is being withdrawn.");
  const updatedBy = ctx.actor.userId;
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(siteSetting)
      .set({ value: sql`${siteSetting.value} - ${item.key}::text`, updatedBy, updatedAt: ctx.now })
      .where(
        and(eq(siteSetting.key, "launch.readiness"), sql`jsonb_typeof(${siteSetting.value}) = 'object'`),
      );
    await audit(
      ctx,
      {
        action: "launch_readiness.clear",
        targetType: "launch_readiness",
        targetId: item.key,
        reason: trimmed.slice(0, 500),
      },
      tx,
    );
  });
}

/**
 * True only when the owner has opened sign-up AND the checklist still passes. If a condition
 * later fails (a legal page is unpublished, the DSL name is removed, a tool loses its approval),
 * sign-up closes by itself without anyone touching the setting.
 */
export async function isSignupOpen(ctx: Pick<Ctx, "db">): Promise<boolean> {
  if (!(await getSetting(ctx, "site.signup_open"))) return false;
  return (await computeLaunchReadiness(ctx)).ready;
}

/**
 * DEVELOPMENT AND TESTS ONLY. Satisfies the checklist with placeholders so that seeded and test
 * environments can open sign-up through the same gate as production: it names a placeholder DSL,
 * records the four manual confirmations as `dev-seed` and publishes placeholder legal pages for
 * any that are missing. It does not approve processors or verify tools, and it does not open
 * sign-up: the caller still calls `setSetting(ctx, "site.signup_open", true)`.
 *
 * Refuses to run when `APP_ENV` is `production` or `preview`.
 */
export async function markLaunchReadyForDev(ctx: Ctx): Promise<LaunchReadiness> {
  if (env.APP_ENV === "production" || env.APP_ENV === "preview") {
    throw new AppError(
      "forbidden",
      "The launch-readiness checklist can't be filled in automatically outside local development and tests.",
    );
  }
  await ctx.db.transaction(async (tx) => {
    const scoped = { db: tx };
    if (!hasText(await getSetting(scoped, "safeguarding.dsl_name"))) {
      const value = "Development placeholder (not a real appointment)";
      await tx
        .insert(siteSetting)
        .values({ key: "safeguarding.dsl_name", value, updatedAt: ctx.now })
        .onConflictDoUpdate({ target: siteSetting.key, set: { value, updatedAt: ctx.now } });
    }

    const existing = await getSetting(scoped, "launch.readiness");
    const confirmations: Record<string, LaunchConfirmation> = { ...existing };
    for (const item of LAUNCH_READINESS_ITEMS) {
      if (item.auto || confirmations[item.key]) continue;
      confirmations[item.key] = {
        confirmedBy: "dev-seed",
        confirmedAt: ctx.now.toISOString(),
        note: "Development placeholder. Not a real sign-off.",
      };
    }
    await tx
      .insert(siteSetting)
      .values({ key: "launch.readiness", value: confirmations, updatedAt: ctx.now })
      .onConflictDoUpdate({ target: siteSetting.key, set: { value: confirmations, updatedAt: ctx.now } });

    for (const slug of REQUIRED_LEGAL_SLUGS) {
      const rows = await tx
        .select({ id: page.id, currentVersionId: page.currentVersionId, status: pageVersion.status })
        .from(page)
        .leftJoin(pageVersion, eq(pageVersion.id, page.currentVersionId))
        .where(and(eq(page.kind, "legal"), eq(page.slug, slug)));
      if (rows.some((r) => r.status === "published")) continue;
      const title = `${slug.replace(/-/g, " ")} (development placeholder)`;
      let pageId = rows[0]?.id;
      if (!pageId) {
        const audience = slug === "privacy-teen" ? ("teen" as const) : ("everyone" as const);
        const inserted = await tx
          .insert(page)
          .values({ slug, kind: "legal", audience, title })
          .returning({ id: page.id });
        pageId = inserted[0]?.id;
      }
      if (!pageId) throw new Error(`Could not create the placeholder legal page "${slug}"`);
      const latest = await tx
        .select({ version: sql<number>`coalesce(max(${pageVersion.version}), 0)::int` })
        .from(pageVersion)
        .where(eq(pageVersion.pageId, pageId));
      const version = await tx
        .insert(pageVersion)
        .values({
          pageId,
          version: (latest[0]?.version ?? 0) + 1,
          title,
          body: "Placeholder text for local development and tests. This is not legal text and must never be published to a live site.",
          status: "published",
          publishedAt: ctx.now,
          changeNote: "Development placeholder",
        })
        .returning({ id: pageVersion.id });
      await tx
        .update(page)
        .set({ currentVersionId: version[0]?.id ?? null, updatedAt: ctx.now })
        .where(eq(page.id, pageId));
    }

    await audit(
      ctx,
      {
        action: "launch_readiness.dev_override",
        targetType: "launch_readiness",
        meta: { appEnv: env.APP_ENV },
      },
      tx,
    );
  });
  return computeLaunchReadiness(ctx);
}

// Re-exported so callers of this module need only one import.
export { LAUNCH_READINESS_ITEMS, type LaunchReadinessKey };
