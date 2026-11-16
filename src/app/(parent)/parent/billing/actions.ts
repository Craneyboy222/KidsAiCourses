"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { requireSession } from "@/server/context";
import { rateLimit } from "@/server/ratelimit";
import { openBillingPortal, resolveBillingAccount, startCardCheck, startCheckout } from "@/server/services/billing";

/**
 * Server Actions for billing (spec Section 13: "Stripe checkout/portal/setup-intent (parent or
 * adult only)"). Each one sends the browser to a page hosted by Stripe; none of them changes what
 * a family is entitled to. That only happens when Stripe's webhook arrives.
 *
 * `requireSession()` rather than `requireParent()`: an 18-year-old who owns their own account
 * pays for themselves. `resolveBillingAccount` is called first in every action, and it refuses
 * every learner under 18 before a rate limit is counted or anything is sent to Stripe.
 */
const checkoutSchema = z.object({
  planKey: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  interval: z.enum(["month", "year"], "Choose monthly or yearly."),
  promoCode: z.string().trim().max(40).optional(),
});

export async function startCheckoutAction(_prev: ActionState<null>, formData: FormData): Promise<ActionState<null>> {
  return runAction(async () => {
    const ctx = await requireSession();
    await resolveBillingAccount(ctx);
    const input = checkoutSchema.parse({ planKey: formData.get("planKey"), interval: formData.get("interval"), promoCode: formData.get("promoCode") || undefined });
    // Tight, because each try with a code is also a guess at a code.
    await rateLimit(ctx, "billing.checkout", { limit: 12, windowSec: 60 * 60 });
    const { url } = await startCheckout(ctx, input);
    redirect(url);
  });
}

export async function openPortalAction(_prev: ActionState<null>, _formData: FormData): Promise<ActionState<null>> {
  return runAction(async () => {
    const ctx = await requireSession();
    await resolveBillingAccount(ctx);
    await rateLimit(ctx, "billing.portal", { limit: 30, windowSec: 60 * 60 });
    const { url } = await openBillingPortal(ctx);
    redirect(url);
  });
}

export async function startCardCheckAction(_prev: ActionState<null>, _formData: FormData): Promise<ActionState<null>> {
  return runAction(async () => {
    const ctx = await requireSession();
    await resolveBillingAccount(ctx);
    await rateLimit(ctx, "billing.card_check", { limit: 10, windowSec: 60 * 60 });
    const { url } = await startCardCheck(ctx);
    redirect(url);
  });
}
