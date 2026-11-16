/**
 * The code of an `AppError`, read from the object itself.
 *
 * Deliberately not `instanceof AppError`: a page, a Route Handler and the services they call can be
 * built into separate bundles, each with its own copy of the class, and an error thrown by one copy
 * is not an instance of another. The `name` and `code` survive that; the class identity does not.
 */
export function appErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === "AppError" && typeof code === "string" ? code : null;
}
