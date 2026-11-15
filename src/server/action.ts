import { ZodError } from "zod";
import { AppError, isAppError } from "./errors";
import { logError } from "./log";

/** The result every Server Action returns. Works with React `useActionState`. */
export type ActionError = { code: string; message: string; fieldErrors?: Record<string, string[]> };
export type ActionState<T = unknown> = { ok: true; data: T } | { ok: false; error: ActionError } | null;

/** Wraps a Server Action body: thrown AppError and ZodError become a safe, teen-readable result. */
export async function runAction<T>(fn: () => Promise<T>): Promise<Exclude<ActionState<T>, null>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    // Next.js uses thrown errors for redirect() and notFound(): let those through untouched.
    if (isNextControlFlow(e)) throw e;
    return { ok: false, error: toActionError(e) };
  }
}

export function toActionError(e: unknown): ActionError {
  if (isAppError(e)) {
    if (e.status >= 500) logError("action.failed", e);
    return { code: e.code, message: e.message, fieldErrors: e.fieldErrors };
  }
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { code: "invalid_input", message: "Some of that didn't look right. Check the highlighted fields and try again.", fieldErrors };
  }
  logError("action.unexpected", e);
  return { code: "internal", message: "Something went wrong on our side. Nothing was lost — try again in a moment." };
}

function isNextControlFlow(e: unknown): boolean {
  const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND";
}

export { AppError };
