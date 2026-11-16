import "server-only";
import { notFound } from "next/navigation";
import { env } from "@/env";
import { getCtx, type Ctx } from "@/server/context";
import { resolveBillingAccount, type BillingAccount } from "@/server/services/billing";
import { fakeCustomerId, readFakeSession, type FakeSession } from "@/server/stripe/fake";

/**
 * Who may open the stand-in Stripe pages, and when.
 *
 *  - Only while `STRIPE_DRIVER=fake` (never in production: `src/env.ts` refuses that setting).
 *  - Only the adult the session was made for: a parent or carer of that family, or the
 *    18-year-old who owns it. These pages show a price, as Stripe's own would, so a learner under
 *    18 gets "not found" here like everywhere else, even with a copied link.
 *  - Only with a session id this server signed, less than a day ago.
 */
export async function requireFakeStripe(sessionId: string): Promise<{ ctx: Ctx; account: BillingAccount; session: FakeSession }> {
  if (env.STRIPE_DRIVER !== "fake") notFound();
  const ctx = await getCtx();
  let account: BillingAccount;
  try {
    account = await resolveBillingAccount(ctx);
  } catch {
    notFound();
  }
  const session = readFakeSession(sessionId, ctx.now);
  if (!session) notFound();
  const belongs = session.kind === "portal" ? session.customerId === fakeCustomerId(account.familyId) : session.metadata.familyId === account.familyId && session.customerId === fakeCustomerId(account.familyId);
  if (!belongs) notFound();
  return { ctx, account, session };
}
