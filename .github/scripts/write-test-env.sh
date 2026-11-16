#!/usr/bin/env bash
# Writes .env.test for CI. The file is git-ignored, so CI has to make its own.
# Every value is a throw-away: the keys are random per run and nothing here reaches a real service.
set -euo pipefail

key() { openssl rand -hex 32; }

cat > .env.test <<ENV
NODE_ENV=test
APP_ENV=test
NEXT_PUBLIC_BRAND_NAME=[Platform Name]
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=${DATABASE_URL:-postgres://app:app@localhost:5432/platform_test}
BETTER_AUTH_SECRET=$(key)
BETTER_AUTH_URL=http://localhost:3000
STAFF_2FA_REQUIRED=false
CRON_SECRET=$(key)
SAFEGUARDING_ENCRYPTION_KEY=$(key)
CONTENT_ENCRYPTION_KEY=$(key)
SEED_PASSWORD=Ci-Seed-$(openssl rand -hex 6)-Pass
OWNER_BOOTSTRAP_EMAIL=owner@example.test
AGE_ASSURANCE_MODE=card_or_subscription
AI_PROVIDER_MODE=fixture
STRIPE_DRIVER=fake
EMAIL_PROVIDER=console
STORAGE_PROVIDER=local
RADAR_FIXTURES=true
PEOPLE_DETECTION_PROVIDER=fixture
DSL_ALERT_EMAILS=owner@example.test
ENV
echo ".env.test written for $(grep -c '' .env.test) variables."
