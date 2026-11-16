import type { Metadata } from "next";
import { ProsePage } from "@/components/marketing/prose-page";
import { Card } from "@/components/ui";
import { env } from "@/env";
import { radarProductToken } from "@/lib/marketing/seo";
import { loadMarketingPage, marketingPageMetadata, type MarketingPageDefaults } from "../_lib/pages";

const PAGE: MarketingPageDefaults = {
  slug: "radar",
  path: "/radar",
  title: "Tool Radar, our web fetcher",
  description: "What our automated fetcher is, what it reads, and how to block it from your site.",
};

export function generateMetadata(): Promise<Metadata> {
  return marketingPageMetadata(PAGE);
}

/**
 * The page our fetcher's User-Agent links to (spec 6.3: "Identify the fetcher with a descriptive
 * User-Agent"). It shows the exact User-Agent in use and the robots.txt lines that block it.
 */
export default async function RadarPage() {
  const page = await loadMarketingPage(PAGE.slug);
  const userAgent = env.RADAR_USER_AGENT;
  const token = radarProductToken(userAgent);
  return (
    <ProsePage
      title={page?.title ?? PAGE.title}
      description={page?.summary ?? PAGE.description}
      body={page?.body ?? null}
      before={
        <Card as="section" aria-labelledby="radar-block" className="flex flex-col gap-4">
          <h2 id="radar-block" className="text-xl font-bold">
            How to recognise it, and how to block it
          </h2>
          <div className="flex flex-col gap-1">
            <p className="font-bold">It sends this User-Agent</p>
            <pre className="rounded-control border-ink bg-tint overflow-x-auto border-2 p-3 text-sm">
              <code>{userAgent}</code>
            </pre>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-bold">To stop it reading your site, add this to your robots.txt</p>
            <pre className="rounded-control border-ink bg-tint overflow-x-auto border-2 p-3 text-sm">
              <code>{`User-agent: ${token}\nDisallow: /`}</code>
            </pre>
          </div>
          <p className="text-ink-muted">You can list single folders instead of the whole site. It checks robots.txt before it reads anything else on a site.</p>
        </Card>
      }
    />
  );
}
