import { logWarn } from "@/server/log";
import { receiveStripeWebhook } from "@/server/services/billing-events";
import { isWebhookSignatureError } from "@/server/stripe";

/**
 * POST /api/webhooks/stripe — the only way a family's plan ever changes (spec 3.7, Section 13).
 *
 * No session and no cookies: the request is trusted because of its signature and nothing else.
 * The body is read as raw text, because the signature covers the exact bytes.
 *
 *   200  handled, already handled, or nothing for us to do
 *   400  the signature is missing, wrong or too old (nothing is stored)
 *   500  something failed on our side; Stripe will send the event again
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stripe's events are a few kilobytes. Anything this large is not one of them. */
const MAX_BODY_BYTES = 1_000_000;

const refuse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return refuse(413, "invalid_input", "That request is too large.");
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return refuse(413, "invalid_input", "That request is too large.");

  try {
    const outcome = await receiveStripeWebhook({ rawBody, signature: request.headers.get("stripe-signature"), requestId: request.headers.get("x-request-id") ?? undefined });
    return Response.json({ received: true, status: outcome.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isWebhookSignatureError(error)) {
      logWarn("stripe.webhook.bad_signature", { reason: error.message });
      return refuse(400, "forbidden", "The signature on that request could not be verified.");
    }
    if (error instanceof Error && error.name === "ZodError") return refuse(400, "invalid_input", "That event was not in the expected form.");
    // Logged in the service. A 500 tells Stripe to try again later.
    return refuse(500, "internal", "Something went wrong on our side. Please send the event again.");
  }
}
