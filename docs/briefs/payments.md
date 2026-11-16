# Brief: Payments and entitlements (test database `platform_test_payments`)

Spec to read in full: Section 3.7, the upgrade flow in Section 4, Section 13 billing routes and webhook, Section 14 Stripe variables, Section 15 plans seed, Section 16 billing tests, Section 17 pricing questions.

## Owns
Services `entitlements.ts`, `unlock-requests.ts` (contracts) plus `billing.ts`, `plans.ts`, `promo.ts`. `src/server/stripe/**` (a `StripeDriver` interface with the real `stripe` SDK implementation and a `fake` driver that behaves the same way for development and tests). `src/app/api/webhooks/stripe/route.ts`. Pages `src/app/(parent)/parent/billing/**`. A read-only `listPublicPlans(ctx)` for the marketing pricing page. Tests in `tests/unit/payments`, `tests/integration/payments`.

## Calls
`recordAgeAssurance`, `grantCredits`, `listChildren`, `listParentUserIds`, notifications, email, audit.

## Requirements
- Plans are data (`plan`): Free and Family (monthly and annual), founding prices, extra seats, 7-day trial with a card. Prices are placeholders the owner edits; never hard-code a price in a component.
- Stripe Checkout for subscribe, the customer portal for changes, a £0 card authorisation (SetupIntent) for age assurance on Free. No card data ever touches our servers.
- **Webhooks are the only source of truth for entitlements.** Verify the signature, record `stripe_event` for idempotency, handle out-of-order and repeated events, and derive `subscription` state from them. Nothing the browser sends grants access. Cover: checkout completed, subscription created, updated, deleted, trial ending, invoice paid and failed (`past_due` grace then downgrade), refund. Cancel keeps access to period end, then reverts to Free; enrolled learners keep finished work and certificates.
- `getEntitlementForLearner` / `ForFamily` and `canAccessCourse` are called on every gated route: make them cheap and correct. Free gets the free courses and the Free credit allowance; Family the full catalogue, seats and the Family allowance. `periodKey` follows the subscription anniversary, or the calendar month on Free.
- **Under-18s never see prices, checkout, invoices or promo entry**, on any surface, including API responses. A learner aged 18 who owns their own account can. Enforce in the service and test it.
- Unlock requests: `requestUnlock` (notifies parents; idempotent while pending), list, decide. Approving a paid-course request takes the parent to the plan choice; approving a Pro-course request grants that course.
- Promo codes: percentage or fixed, expiry, redemption limits, one per family, applied through Stripe coupons on the real driver; admin functions for the Studio screens (`createPromo`, `listPromos`, `disablePromo`). Billing exceptions (comped plan, extended trial) are admin-only and audited.
- Parent billing page: current plan, seats, next payment date, upgrade, manage, invoices via the portal, age-assurance card step with a plain explanation of why it is asked.

## Tests required
Webhook fixtures for every event above, including duplicates and out-of-order delivery; forged signature refused; entitlement changes only after a webhook; grace and downgrade; cancel at period end; seats; promo limits; age assurance recorded by SetupIntent and by paid subscription; no price in any learner-facing payload; adult learner can pay for themselves.

## Verify
typecheck; eslint on your paths; `TEST_DB_NAME=platform_test_payments pnpm vitest run tests/unit/payments tests/integration/payments`.
