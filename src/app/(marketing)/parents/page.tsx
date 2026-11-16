import type { Metadata } from "next";
import { MarketingTextPage, marketingPageMetadata, type MarketingPageDefaults } from "../_lib/pages";

const PAGE: MarketingPageDefaults = {
  slug: "parents",
  path: "/parents",
  title: "For parents and carers",
  description: "What your child does here, what you control, what you can and cannot see, and what we ask of you.",
};

export function generateMetadata(): Promise<Metadata> {
  return marketingPageMetadata(PAGE);
}

/** The parent landing page (spec Section 5: `/parents`). The words are the marketing page `parents`, editable in Studio. */
export default function ParentsPage() {
  return <MarketingTextPage defaults={PAGE} />;
}
