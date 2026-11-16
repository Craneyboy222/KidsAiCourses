import { resolveCtx } from "@/server/context";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { CATALOGUE_PAGE_SIZE, listCatalogue, parseCatalogueFilters } from "@/server/services/catalogue";
import { NO_STORE } from "../_lib/learner";

/**
 * GET /api/v1/courses — the catalogue (spec 3.2, Section 13).
 *
 * Signed out: the public catalogue. Signed in as a learner: their own catalogue, which never
 * contains a course above their age or one a parent has blocked, and marks paid courses on the
 * Free plan as `locked`. No price is ever part of this response.
 * Query: `q`, `category`, `pathway`, `difficulty`, `time` (max minutes), `tool`, `free=1`,
 * `sort` (`for_you` | `new` | `popular` | `shortest`), `page`.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const ctx = await resolveCtx(req.headers);
  await rateLimit(ctx, "catalogue.list", { limit: 120, windowSec: 60 });
  const { page, ...filters } = parseCatalogueFilters(new URL(req.url).searchParams);
  const viewer = ctx.actor.type === "learner" ? ({ kind: "learner", learnerId: ctx.actor.userId } as const) : ({ kind: "public" } as const);
  const result = await listCatalogue(ctx, viewer, { ...filters, limit: CATALOGUE_PAGE_SIZE, offset: (page - 1) * CATALOGUE_PAGE_SIZE });
  return Response.json({ ...result, page, pageSize: CATALOGUE_PAGE_SIZE }, NO_STORE);
});
