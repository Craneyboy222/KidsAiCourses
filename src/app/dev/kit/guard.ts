import { notFound } from "next/navigation";

/**
 * The kit showcase is a development and test tool. In a production build it
 * returns 404 unless the deployment is explicitly a test or local environment.
 *
 * This reads process.env directly rather than `@/env`: the showcase must render
 * with no database or secrets configured, and `@/env` validates all of them.
 */
export function assertKitAvailable(): void {
  const appEnv = process.env.APP_ENV;
  if (process.env.NODE_ENV === "production" && appEnv !== "test" && appEnv !== "local") notFound();
}
