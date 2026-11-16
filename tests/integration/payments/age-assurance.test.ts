import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAgeAssurance } from "@/server/services/age-assurance";
import { getBillingOverview, startCardCheck } from "@/server/services/billing";
import { completeFakeSetup } from "@/server/stripe/fake-simulator";
import { closeDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner } from "../../helpers/factories";
import { T0, auditRows, daysAfter, entitlementAt, familyRow, invoiceEvent, linkCustomer, notificationsFor, send, setUpBilling, subEvent, subState, subscribe, sys } from "./helpers";

beforeEach(setUpBilling);

/** Is the card check still what stands between this learner and Coach? (Consents are the accounts slice's half.) */
const needsCard = async (learnerId: string) => (await getAgeAssurance(sys(), learnerId)).missing.includes("card_or_subscription");
afterAll(closeDb);

describe("age assurance is recorded by Stripe's webhooks, never by the browser", () => {
  it("a £0 card check (SetupIntent) on Free records card_authorisation and opens Coach for a 13–15-year-old", async () => {
    const { family, parentActor } = await createFamily();
    const { user: teen } = await createLearner({ age: 14, familyId: family.id, nickname: "Maya", now: T0 });
    const ctx = testCtx(parentActor, { now: T0 });

    expect((await getBillingOverview(ctx)).ageAssurance).toMatchObject({ level: "none", needed: true, waitingFor: ["Maya"] });
    expect(await needsCard(teen.id)).toBe(true);

    const { url } = await startCardCheck(ctx);
    // Being sent to the card page, and even coming back from it, proves nothing.
    expect((await familyRow(family.id))?.ageAssuranceLevel).toBe("none");
    expect(await needsCard(teen.id)).toBe(true);

    const { returnPath } = await completeFakeSetup(decodeURIComponent(url.split("session=")[1] ?? ""), T0);
    expect(returnPath).toBe("/parent/billing?card=checked");
    expect(await familyRow(family.id)).toMatchObject({ ageAssuranceLevel: "card_authorisation", ageAssuredAt: T0, plan: "free" });
    expect(await needsCard(teen.id)).toBe(false);
    // No plan was bought: still Free.
    expect((await entitlementAt(family.id)).planKey).toBe("free");

    const [entry] = await auditRows("age_assurance.record");
    expect(entry?.meta).toMatchObject({ method: "card_authorisation", previous: "none" });
    // Stripe sends two events for one card check; the parent is told once.
    expect(await notificationsFor(parentActor.userId, "billing.card_checked")).toHaveLength(1);
    expect((await getBillingOverview(ctx)).ageAssurance).toMatchObject({ level: "card_authorisation", needed: false });
  });

  it("a trial started with a card records card_authorisation; the first real payment records paid_subscription", async () => {
    const { family } = await createFamily();
    const { user: teen } = await createLearner({ age: 13, familyId: family.id, now: T0 });
    const state = await subscribe(family.id, { status: "trialing", trialEnd: daysAfter(7), periodEnd: daysAfter(7) });
    await send(invoiceEvent("paid", state, T0, { amountPaidPence: 0 }));
    expect((await familyRow(family.id))?.ageAssuranceLevel).toBe("card_authorisation");
    expect(await needsCard(teen.id)).toBe(false);

    await send(invoiceEvent("paid", state, daysAfter(7)), daysAfter(7));
    expect((await familyRow(family.id))?.ageAssuranceLevel).toBe("paid_subscription");
  });

  it("an active paid subscription records paid_subscription, and losing the plan later does not undo it", async () => {
    const { family } = await createFamily();
    const state = await subscribe(family.id);
    expect((await familyRow(family.id))?.ageAssuranceLevel).toBe("paid_subscription");
    await send(subEvent("deleted", { ...state, status: "canceled" }, daysAfter(40)), daysAfter(40));
    expect(await familyRow(family.id)).toMatchObject({ plan: "free", ageAssuranceLevel: "paid_subscription" });
  });

  it("a setup intent that did not succeed records nothing", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const { fakeDelivery, fakeSetupIntentObject } = await import("@/server/stripe/fake");
    const state = subState(family.id);
    await send(fakeDelivery("setup_intent.succeeded", fakeSetupIntentObject({ customerId: state.customerId, familyId: family.id, status: "requires_payment_method" }), { created: T0 }));
    expect((await familyRow(family.id))?.ageAssuranceLevel).toBe("none");
  });
});
