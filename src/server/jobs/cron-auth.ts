import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

/**
 * Checks `Authorization: Bearer <CRON_SECRET>` in constant time. Both sides are hashed first, so
 * they are always the same length and the comparison leaks nothing about the secret, not even
 * how long it is.
 */
export function isAuthorisedCronRequest(header: string | null, secret: string = env.CRON_SECRET): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
