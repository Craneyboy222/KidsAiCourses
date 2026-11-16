import { env } from "@/env";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { isProcessorEnabled } from "@/server/processors";
import type { StripeDriver } from "./driver";

export * from "./driver";
export * from "./types";

let current: StripeDriver | undefined;

/**
 * The driver chosen by `STRIPE_DRIVER`. The real one is loaded only when asked for, so the fake
 * never imports the Stripe SDK and the real one never ships the fake's signing code.
 */
export async function getStripeDriver(): Promise<StripeDriver> {
  if (current && current.name === env.STRIPE_DRIVER) return current;
  const driver = env.STRIPE_DRIVER === "stripe" ? (await import("./real")).createRealStripeDriver() : (await import("./fake")).createFakeStripeDriver();
  current = driver;
  return driver;
}

/**
 * The driver for a call that sends a family's details to Stripe (checkout, the portal, a card
 * check). Stripe is an outside processor: besides the environment variable, the owner must have
 * approved it and switched it on in Studio (docs/ARCHITECTURE.md). The fake sends nothing anywhere.
 */
export async function getStripeDriverForUse(ctx: Pick<Ctx, "db">): Promise<StripeDriver> {
  const driver = await getStripeDriver();
  if (driver.name === "stripe" && !(await isProcessorEnabled(ctx, "stripe"))) {
    throw new AppError("not_ready", "Payments aren't switched on yet. Nothing has been charged. Please try again later.", { status: 503, detail: { reason: "processor_not_enabled" } });
  }
  return driver;
}

/** Tests only: use this driver (for example a fake with a pinned clock), or pass `null` to go back to the configured one. */
export function setStripeDriverForTests(driver: StripeDriver | null): void {
  current = driver ?? undefined;
}
