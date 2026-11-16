"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { AppError } from "@/server/errors";
import { FAKE_PORTAL_ACTIONS, completeFakeCheckout, completeFakeSetup, findFakeSubscriptionForCustomer, simulateSubscriptionChange } from "@/server/stripe/fake-simulator";
import { FAKE_PORTAL_PATH } from "@/server/stripe/fake";
import { requireFakeStripe } from "./guard";

/**
 * What the buttons on the stand-in Stripe pages do: they make "Stripe" send webhooks. None of
 * them writes to our tables. The plan changes only because the webhook handler, the same one the
 * real endpoint uses, accepts the signed events.
 */
const sessionField = z.string().min(20).max(4000);

export async function completeFakeCheckoutAction(_prev: ActionState<null>, formData: FormData): Promise<ActionState<null>> {
  return runAction(async () => {
    const sessionId = sessionField.parse(formData.get("session"));
    const { ctx, session } = await requireFakeStripe(sessionId);
    if (session.kind === "portal") throw new AppError("not_found", "That page has expired. Go back and start again.");
    const { returnPath } = session.kind === "setup" ? await completeFakeSetup(sessionId, ctx.now) : await completeFakeCheckout(sessionId, ctx.now);
    redirect(returnPath);
  });
}

export async function fakePortalAction(_prev: ActionState<null>, formData: FormData): Promise<ActionState<null>> {
  return runAction(async () => {
    const sessionId = sessionField.parse(formData.get("session"));
    const change = z.enum(FAKE_PORTAL_ACTIONS).parse(formData.get("change"));
    const { ctx, session } = await requireFakeStripe(sessionId);
    if (session.kind !== "portal") throw new AppError("not_found", "That page has expired. Go back and start again.");
    const subscriptionId = await findFakeSubscriptionForCustomer(session.customerId);
    if (!subscriptionId) throw new AppError("conflict", "There is no running plan to change.");
    await simulateSubscriptionChange(subscriptionId, { kind: change }, ctx.now);
    redirect(`${FAKE_PORTAL_PATH}?session=${encodeURIComponent(sessionId)}&done=${change}`);
  });
}
