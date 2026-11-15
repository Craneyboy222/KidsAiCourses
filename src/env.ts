import { z } from "zod";

/**
 * Every environment variable the app reads, validated once at boot.
 * Nothing else may read process.env. Only NEXT_PUBLIC_ values reach the browser
 * and none of them may be secret.
 */
const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .default(def ? "true" : "false")
    .transform((v) => v === "true" || v === "1");
const optional = () => z.string().min(1).optional();
const num = (def: number) => z.coerce.number().default(def);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "test", "preview", "production"]).default("local"),
  NEXT_PUBLIC_BRAND_NAME: z.string().default("[Platform Name]"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  TZ_DISPLAY: z.string().default("Europe/London"),

  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: optional(),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  STAFF_2FA_REQUIRED: bool(true),
  OWNER_BOOTSTRAP_EMAIL: optional(),
  SEED_PASSWORD: optional(),
  PASSWORD_BREACH_CHECK: z.enum(["local", "hibp"]).default("local"),
  /** ⚖️ Confirm the method with legal before launch (spec 3.1, Q5). */
  AGE_ASSURANCE_MODE: z.enum(["card_or_subscription", "parent_email", "off_dev_only"]).default("card_or_subscription"),

  // AI: Coach and course drafting
  AI_PROVIDER_MODE: z.enum(["fixture", "gateway"]).default("fixture"),
  AI_GATEWAY_API_KEY: optional(),
  MODERATION_PROVIDER: z.enum(["rules", "gateway"]).default("rules"),
  MODERATION_API_KEY: optional(),
  PEOPLE_DETECTION_PROVIDER: z.enum(["manual", "fixture"]).default("manual"),
  AI_DAILY_SPEND_CAP_GBP: num(20),
  AI_FEATURE_CAPS_JSON: z.string().default("{}"),
  CREDIT_VALUE_PENCE: num(0.1),
  FREE_MONTHLY_CREDITS: num(50),
  FAMILY_MONTHLY_CREDITS: num(200),

  // Stripe
  STRIPE_DRIVER: z.enum(["fake", "stripe"]).default("fake"),
  STRIPE_SECRET_KEY: optional(),
  STRIPE_WEBHOOK_SECRET: optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optional(),
  STRIPE_PRICE_FAMILY_MONTHLY: optional(),
  STRIPE_PRICE_FAMILY_ANNUAL: optional(),
  STRIPE_PRICE_FAMILY_FOUNDING_MONTHLY: optional(),
  STRIPE_PRICE_FAMILY_FOUNDING_ANNUAL: optional(),
  STRIPE_PRICE_EXTRA_SEAT_MONTHLY: optional(),

  // Storage
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/storage"),
  STORAGE_BUCKET_PRIVATE: z.string().default("private"),
  STORAGE_BUCKET_PUBLIC: z.string().default("public"),
  STORAGE_S3_ENDPOINT: optional(),
  STORAGE_S3_REGION: z.string().default("eu-west-2"),
  STORAGE_S3_ACCESS_KEY_ID: optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: optional(),
  SUPABASE_URL: optional(),
  SUPABASE_SERVICE_ROLE_KEY: optional(),

  // Email
  EMAIL_PROVIDER: z.enum(["console", "resend", "postmark"]).default("console"),
  EMAIL_API_KEY: optional(),
  EMAIL_FROM: z.string().default("[Platform Name] <hello@example.test>"),
  EMAIL_REPLY_TO: optional(),

  // Jobs
  INNGEST_EVENT_KEY: optional(),
  INNGEST_SIGNING_KEY: optional(),
  INNGEST_DEV: bool(false),
  CRON_SECRET: z.string().min(16),

  // Safety
  SAFEGUARDING_ENCRYPTION_KEY: z.string().min(32),
  CONTENT_ENCRYPTION_KEY: z.string().min(32),
  DSL_ALERT_EMAILS: z.string().default(""),
  DEPUTY_DSL_ALERT_EMAILS: z.string().default(""),

  // Optional, only if approved
  SENTRY_DSN: optional(),
  NEXT_PUBLIC_POSTHOG_KEY: optional(),
  TURNSTILE_SECRET_KEY: optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optional(),

  // Radar and drafting (defaults; live values are admin-configurable)
  RADAR_ENABLED: bool(false),
  RADAR_FIXTURES: bool(false),
  RADAR_AUTODRAFT_THRESHOLD: num(70),
  RADAR_MAX_COST_PER_DRAFT_GBP: num(1.5),
  RADAR_MONTHLY_BUDGET_GBP: num(40),
  RADAR_USER_AGENT: z.string().default("PlatformRadar/1.0 (+http://localhost:3000/radar)"),
  PRODUCTHUNT_API_TOKEN: optional(),
  GITHUB_TOKEN: optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${lines}\nSee .env.example.`);
  }
  const env = parsed.data;
  if (env.APP_ENV === "production") {
    const problems: string[] = [];
    if (env.AGE_ASSURANCE_MODE === "off_dev_only") problems.push("AGE_ASSURANCE_MODE=off_dev_only is not allowed in production");
    if (env.SEED_PASSWORD) problems.push("SEED_PASSWORD must not be set in production");
    if (env.STRIPE_DRIVER === "fake") problems.push("STRIPE_DRIVER=fake is not allowed in production");
    if (env.RADAR_FIXTURES) problems.push("RADAR_FIXTURES must be false in production");
    if (problems.length) throw new Error(`Unsafe production configuration:\n  ${problems.join("\n  ")}`);
  }
  return env;
}

let cached: Env | undefined;
/** Lazily validated so that `next build` can import modules without a full environment. */
export function getEnv(): Env {
  return (cached ??= load());
}
/** Convenience proxy: `env.DATABASE_URL`. */
export const env: Env = new Proxy({} as Env, {
  get: (_t, key: string) => getEnv()[key as keyof Env],
});
/** Test helper. */
export function resetEnvCache(): void {
  cached = undefined;
}
