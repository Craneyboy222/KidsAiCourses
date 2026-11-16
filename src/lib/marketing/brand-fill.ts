import { BRAND_NAME } from "@/lib/brand";

/**
 * Page text is written with `{{brandName}}` where the product's name goes, the same placeholder
 * the copy registry uses, so the name is still set in one place.
 */
export function fillBrand(text: string): string {
  return text.replace(/\{\{\s*brandName\s*\}\}/g, BRAND_NAME);
}
