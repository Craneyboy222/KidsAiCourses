import type { Metadata } from "next";
import { MarketingTextPage, marketingPageMetadata, type MarketingPageDefaults } from "../_lib/pages";

const PAGE: MarketingPageDefaults = {
  slug: "safety",
  path: "/safety",
  title: "Safety",
  description: "How accounts, consent, outside tools, Coach, checks on work and reporting actually work, and what we cannot promise.",
};

export function generateMetadata(): Promise<Metadata> {
  return marketingPageMetadata(PAGE);
}

/** The safety overview (spec Section 5). Written from what the product does; the words are the marketing page `safety`, editable in Studio. */
export default function SafetyPage() {
  return <MarketingTextPage defaults={PAGE} />;
}
