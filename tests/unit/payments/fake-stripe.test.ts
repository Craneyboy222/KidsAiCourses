import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { WebhookSignatureError } from "@/server/stripe/driver";
import { createFakeStripeDriver, fakeChargeObject, fakeCustomerId, fakeDelivery, fakeInvoiceObject, fakeSetupIntentObject, fakeSubscriptionObject, readFakeSession, signWebhookPayload, type FakeSubscriptionState } from "@/server/stripe/fake";
import { eventsForChange } from "@/server/stripe/fake-simulator";
import { refId } from "@/server/stripe/types";

const NOW = new Date("2026-11-16T10:00:00Z");
const driver = createFakeStripeDriver(() => NOW);
const FAMILY = "0b0f3c9e-58f6-4c0e-9d0e-1f4a7a0f7a11";

const state: FakeSubscriptionState = {
  id: "sub_1",
  customerId: fakeCustomerId(FAMILY),
  familyId: FAMILY,
  priceId: "price_fake_family_monthly",
  status: "active",
  createdAt: NOW,
  periodStart: NOW,
  periodEnd: new Date("2026-12-16T10:00:00Z"),
  trialEnd: null,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  extraSeats: 2,
  extraSeatPriceId: "price_fake_family_extra_seat",
};

describe("webhook signatures", () => {
  const delivery = fakeDelivery("customer.subscription.updated", fakeSubscriptionObject(state), { created: NOW, id: "evt_1" });

  it("accepts a body signed with the secret and returns the narrowed event", () => {
    const event = driver.constructEvent(delivery.payload, delivery.signature, NOW);
    expect(event).toMatchObject({ id: "evt_1", type: "customer.subscription.updated", created: Math.floor(NOW.getTime() / 1000) });
    if (event.type !== "customer.subscription.updated") throw new Error("wrong type");
    expect(event.object.items.data.map((item) => [item.price.id, item.quantity])).toEqual([
      ["price_fake_family_monthly", 1],
      ["price_fake_family_extra_seat", 2],
    ]);
    expect(refId(event.object.customer)).toBe(fakeCustomerId(FAMILY));
  });

  it.each([
    ["no signature", null],
    ["an empty signature", ""],
    ["a signature made with another secret", signWebhookPayload(delivery.payload, NOW, "whsec_guess")],
    ["a signature for a different body", signWebhookPayload(`${delivery.payload} `, NOW)],
    ["a made-up signature", `t=${Math.floor(NOW.getTime() / 1000)},v1=${"0".repeat(64)}`],
    ["a header with no timestamp", "v1=abc"],
  ])("refuses %s", (_name, header) => {
    expect(() => driver.constructEvent(delivery.payload, header, NOW)).toThrow(WebhookSignatureError);
  });

  it("refuses a correct signature that is more than five minutes old or from the future", () => {
    const later = new Date(NOW.getTime() + 6 * 60 * 1000);
    expect(() => driver.constructEvent(delivery.payload, delivery.signature, later)).toThrow(/too old/);
    expect(() => driver.constructEvent(delivery.payload, signWebhookPayload(delivery.payload, later), NOW)).toThrow(WebhookSignatureError);
    expect(() => driver.constructEvent(delivery.payload, delivery.signature, new Date(NOW.getTime() + 4 * 60 * 1000))).not.toThrow();
  });

  it("checks the signature before it reads the body", () => {
    expect(() => driver.constructEvent("not json", "t=1,v1=bad", NOW)).toThrow(WebhookSignatureError);
  });

  it("a signed event of a kind we do not act on comes back as `other`; a malformed one we do act on is an error", () => {
    const other = fakeDelivery("customer.created", { id: "cus_1" }, { created: NOW });
    expect(driver.constructEvent(other.payload, other.signature, NOW)).toMatchObject({ type: "other", rawType: "customer.created" });
    const broken = fakeDelivery("invoice.paid", { id: "in_1" }, { created: NOW });
    expect(() => driver.constructEvent(broken.payload, broken.signature, NOW)).toThrow(ZodError);
  });
});

describe("sessions are signed tokens", () => {
  const input = { customerId: fakeCustomerId(FAMILY), priceId: "price_fake_family_monthly", trialDays: 7, metadata: { familyId: FAMILY, userId: FAMILY, planKey: "family" }, successPath: "/parent/billing?checkout=success", cancelPath: "/parent/billing/plans" };

  it("round-trips a checkout session and points at the local stand-in page", async () => {
    const session = await driver.createCheckoutSession(input);
    expect(session.url).toBe(`/dev/fake-stripe/checkout?session=${encodeURIComponent(session.id)}`);
    expect(readFakeSession(session.id, NOW)).toMatchObject({ kind: "subscription", priceId: input.priceId, trialDays: 7, metadata: input.metadata });
    const setup = await driver.createSetupSession({ customerId: input.customerId, metadata: { familyId: FAMILY, userId: FAMILY }, successPath: "/parent/billing?card=checked", cancelPath: "/parent/billing" });
    expect(readFakeSession(setup.id, NOW)?.kind).toBe("setup");
    expect((await driver.createPortalSession({ customerId: input.customerId, returnPath: "/parent/billing" })).url).toMatch(/^\/dev\/fake-stripe\/portal\?session=/);
  });

  it("refuses a session that was altered, made up, or is more than a day old", async () => {
    const { id } = await driver.createCheckoutSession(input);
    const [body = "", signature = ""] = id.slice("fs_fake_".length).split(".");
    const cheaper = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), trialDays: 365 })).toString("base64url");
    expect(readFakeSession(`fs_fake_${cheaper}.${signature}`, NOW)).toBeNull();
    expect(readFakeSession("fs_fake_abc.def", NOW)).toBeNull();
    expect(readFakeSession("cs_live_123", NOW)).toBeNull();
    expect(readFakeSession(id, new Date(NOW.getTime() + 25 * 60 * 60 * 1000))).toBeNull();
  });

  it("only ever returns to a path on this site", async () => {
    await expect(driver.createCheckoutSession({ ...input, successPath: "https://evil.example/" }).then((s) => readFakeSession(s.id, NOW))).resolves.toBeNull();
    await expect(driver.createCheckoutSession({ ...input, successPath: "//evil.example/" }).then((s) => readFakeSession(s.id, NOW))).resolves.toBeNull();
  });
});

describe("the events the fake sends for each change", () => {
  const current = { state: { ...state, extraSeats: 0 }, interval: "month" as const, pricePence: 1000 };
  const types = (change: Parameters<typeof eventsForChange>[1]) => eventsForChange(current, change, NOW).map((d) => d.type);

  it("covers every event the handler acts on", () => {
    expect(types({ kind: "cancel_at_period_end" })).toEqual(["customer.subscription.updated"]);
    expect(types({ kind: "cancel_now" })).toEqual(["customer.subscription.deleted"]);
    expect(types({ kind: "period_end" })).toEqual(["invoice.paid", "customer.subscription.updated"]);
    expect(types({ kind: "payment_failed" })).toEqual(["invoice.payment_failed", "customer.subscription.updated"]);
    expect(types({ kind: "payment_recovered" })).toEqual(["invoice.paid", "customer.subscription.updated"]);
    expect(types({ kind: "trial_will_end" })).toEqual(["customer.subscription.trial_will_end"]);
    expect(types({ kind: "refund" })).toEqual(["charge.refunded"]);
    expect(eventsForChange({ ...current, state: { ...current.state, cancelAtPeriodEnd: true } }, { kind: "period_end" }, NOW).map((d) => d.type)).toEqual(["customer.subscription.deleted"]);
  });

  it("builds objects the driver accepts back", () => {
    for (const [type, object] of [
      ["invoice.paid", fakeInvoiceObject({ customerId: "cus_1", subscriptionId: "sub_1", amountPaidPence: 1 })],
      ["charge.refunded", fakeChargeObject({ customerId: "cus_1", amountPence: 10, refundedPence: 10 })],
      ["setup_intent.succeeded", fakeSetupIntentObject({ customerId: "cus_1", familyId: FAMILY })],
    ] as const) {
      const delivery = fakeDelivery(type, object, { created: NOW });
      expect(driver.constructEvent(delivery.payload, delivery.signature, NOW).type).toBe(type);
    }
  });
});
