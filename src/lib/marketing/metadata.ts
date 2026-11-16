import type { Metadata } from "next";
import { BRAND_NAME } from "@/lib/brand";

/** The square brand mark. A real file with fixed dimensions, served from this site. */
const SHARE_IMAGE = { url: "/icons/icon-512.png", width: 512, height: 512, alt: `${BRAND_NAME} logo` };

export type PublicPageMeta = {
  /** Without the brand name: the root layout adds it. */
  title: string;
  description: string;
  /** The page's own address, used as the canonical link. */
  path: string;
  /** False for pages that must not be listed by search engines. */
  index?: boolean;
  type?: "website" | "article";
  /** Use the title exactly as given, with no brand suffix (the home page). */
  absoluteTitle?: boolean;
};

/**
 * Metadata for a public page: title, description, canonical address, Open Graph and a summary
 * card. Addresses are relative; the marketing layout sets `metadataBase`.
 */
export function publicPageMetadata(page: PublicPageMeta): Metadata {
  const index = page.index ?? true;
  const shareTitle = page.absoluteTitle ? page.title : `${page.title} · ${BRAND_NAME}`;
  return {
    title: page.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: index ? { canonical: page.path } : undefined,
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: shareTitle,
      description: page.description,
      url: page.path,
      siteName: BRAND_NAME,
      locale: "en_GB",
      type: page.type ?? "website",
      images: [SHARE_IMAGE],
    },
    twitter: { card: "summary", title: shareTitle, description: page.description, images: [SHARE_IMAGE.url] },
  };
}

/** A description short enough for a search result: one line, at most 160 characters, cut at a word. */
export function metaDescription(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).trimEnd()}…`;
}
