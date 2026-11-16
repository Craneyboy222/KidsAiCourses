import type { Metadata } from "next";
import { MarketingTextPage, marketingPageMetadata, type MarketingPageDefaults } from "../_lib/pages";

const PAGE: MarketingPageDefaults = {
  slug: "how-it-works",
  path: "/how-it-works",
  title: "How it works",
  description: "From setting up a family account to a finished project in a private portfolio, step by step.",
};

export function generateMetadata(): Promise<Metadata> {
  return marketingPageMetadata(PAGE);
}

/** How a course works from start to finish, and how courses are made. The words are the marketing page `how-it-works`, editable in Studio. */
export default function HowItWorksPage() {
  return <MarketingTextPage defaults={PAGE} />;
}
