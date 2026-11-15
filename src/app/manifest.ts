import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/lib/brand";

/** Web app manifest: makes the platform installable as a progressive web app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME.length > 12 ? BRAND_NAME.replace(/[[\]]/g, "").slice(0, 12).trim() : BRAND_NAME,
    description: "Learn today's AI tools by making things you actually care about.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en-GB",
    dir: "ltr",
    background_color: "#fbfaf7",
    theme_color: "#fbfaf7",
    categories: ["education"],
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
