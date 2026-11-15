import { AppError } from "@/server/errors";

/**
 * Cross-slice contracts.
 *
 * Files in this folder that start with a "CONTRACT" comment were written by the lead so that
 * slices built in parallel can call each other. The exported names, parameters and return
 * types are fixed. The owning slice replaces each body (and may add more exports). Do not
 * change a signature without telling the lead in your report.
 */
export function notImplemented(name: string): never {
  throw new AppError("internal", "This part of the site isn't ready yet. Try again soon.", { detail: { notImplemented: name } });
}
