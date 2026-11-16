/**
 * `pnpm exec tsx scripts/dev-open-signup.ts` — LOCAL DEVELOPMENT AND TESTS ONLY.
 *
 * Opens sign-up on a development database so the sign-up pages can be tried: fills the
 * launch-readiness checklist with clearly labelled placeholders (`markLaunchReadyForDev`), switches
 * `site.signup_open` on through the real gate, and loads the consent wording from
 * `content/consents`. `--close` switches sign-up off again.
 *
 * It cannot be used to open a real site: `markLaunchReadyForDev` refuses to run when `APP_ENV` is
 * `preview` or `production`, and so does this script.
 *
 * Loads `.env.local` unless `DOTENV_PATH` names another file. A `DATABASE_URL` already in the
 * environment wins, so a check can be pointed at its own database.
 */
import { config } from "dotenv";
import { env } from "@/env";
import { systemCtx } from "@/server/context";
import { closeDb } from "@/server/db/client";
import { databaseName } from "@/server/db/migrate";
import { setSetting } from "@/server/settings";
import { isSignupOpen, markLaunchReadyForDev } from "@/server/settings/launch-readiness";
import { importConsents } from "./import-consents";

// DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });

async function main(): Promise<void> {
  if (env.APP_ENV !== "local" && env.APP_ENV !== "test") {
    throw new Error(`dev-open-signup only runs with APP_ENV=local or test (it is "${env.APP_ENV}"). Real sign-up is opened from Studio, once the launch-readiness checklist passes.`);
  }
  const ctx = systemCtx("dev.open_signup");
  const name = databaseName(env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL);
  try {
    if (process.argv.includes("--close")) {
      await setSetting(ctx, "site.signup_open", false, "Development: sign-up closed again");
      console.info(`Sign-up is now closed on "${name}".`);
      return;
    }
    const readiness = await markLaunchReadyForDev(ctx);
    if (!readiness.ready) {
      const open = readiness.outstanding.map((item) => `${item.key} (${item.detail})`);
      throw new Error(`The launch-readiness checklist still has open items that placeholders cannot fill: ${open.join("; ")}`);
    }
    await setSetting(ctx, "site.signup_open", true, "Development: sign-up opened with placeholder readiness");
    const consents = await importConsents(ctx);
    console.info(
      `Sign-up is ${(await isSignupOpen(ctx)) ? "open" : "STILL CLOSED"} on "${name}" (placeholder readiness, not a real sign-off). Consents: ${consents.inserted.length} added, ${consents.unchanged.length} unchanged.`,
    );
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error("dev-open-signup failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
