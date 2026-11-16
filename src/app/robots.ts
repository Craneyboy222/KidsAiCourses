import type { MetadataRoute } from "next";
import { env } from "@/env";
import { buildRobots } from "@/lib/marketing/seo";

/**
 * robots.txt. Signed-in areas, the API and development pages are closed to crawlers; the
 * marketing, course and help pages are open. Anything that is not the production site is closed
 * completely. The rules are in `src/lib/marketing/site.ts`.
 */
export default function robots(): MetadataRoute.Robots {
  return buildRobots({ appUrl: env.NEXT_PUBLIC_APP_URL, indexable: env.APP_ENV === "production" });
}
