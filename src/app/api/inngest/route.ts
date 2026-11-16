import type { NextRequest } from "next/server";
import { serve } from "inngest/next";
import { json } from "@/server/http";
import { buildInngestFunctions, getInngest, inngestConfigured } from "@/server/jobs/inngest";

/**
 * The endpoint Inngest calls to discover and run our jobs. Requests are signed by Inngest and
 * checked with `INNGEST_SIGNING_KEY`. When Inngest is not configured the route answers
 * "not found", so nothing is exposed.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Handlers = ReturnType<typeof serve>;
let handlers: Handlers | undefined;

function getHandlers(): Handlers | null {
  if (!inngestConfigured()) return null;
  // Built on the first request so that `next build` needs no environment.
  return (handlers ??= serve({ client: getInngest(), functions: buildInngestFunctions() }));
}

const notConfigured = () =>
  json(
    { error: { code: "not_found", message: "Background jobs are not configured here." } },
    { status: 404 },
  );

export async function GET(request: NextRequest, context: unknown): Promise<Response> {
  return getHandlers()?.GET(request, context) ?? notConfigured();
}
export async function POST(request: NextRequest, context: unknown): Promise<Response> {
  return getHandlers()?.POST(request, context) ?? notConfigured();
}
export async function PUT(request: NextRequest, context: unknown): Promise<Response> {
  return getHandlers()?.PUT(request, context) ?? notConfigured();
}
