import { z } from "zod";
import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { getJob, runJob } from "@/server/jobs";
import { isAuthorisedCronRequest } from "@/server/jobs/cron-auth";

/**
 * Cron fallback for running a job by name without Inngest, e.g. from Vercel Cron or any
 * scheduler that can send a header:
 *
 *   POST /api/jobs/ratelimit.cleanup        Authorization: Bearer <CRON_SECRET>
 *
 * Optional JSON body: `{ "payload": {...}, "idempotencyKey": "..." }`. Without a key, runs in the
 * same minute share one, so a scheduler that fires twice does the work once.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ name: string }> };

const bodySchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

async function run(req: Request, context: RouteContext) {
  if (!isAuthorisedCronRequest(req.headers.get("authorization"))) {
    throw new AppError("unauthenticated", "This address is for scheduled jobs only.");
  }
  const { name } = await context.params;
  const job = getJob(name);
  if (!job) throw new AppError("not_found", "That job doesn't exist.");

  let body: z.infer<typeof bodySchema> = {};
  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.trim() !== "") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new AppError("invalid_input", "The request body must be JSON.");
      }
      body = bodySchema.parse(parsed);
    }
  }
  const minute = new Date().toISOString().slice(0, 16);
  const result = await runJob(job, body.payload, {
    idempotencyKey: `${job.name}:${body.idempotencyKey ? `cron:${body.idempotencyKey}` : `minute:${minute}`}`,
  });
  return { job: job.name, ...result };
}

// Vercel Cron sends GET; most other schedulers can POST.
export const GET = handle(run);
export const POST = handle(run);
