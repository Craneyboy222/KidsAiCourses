import { env } from "@/env";
import { AppError } from "@/server/errors";
import { checkPassword, type PasswordContext } from "./password-policy";

/**
 * Applies the password policy with the configured breach-check mode (decision D10) and throws a
 * field-level `AppError` that forms can show next to the password box.
 */
export async function assertPasswordAllowed(password: string, context?: PasswordContext): Promise<void> {
  const result = await checkPassword(password, { breachCheck: env.PASSWORD_BREACH_CHECK, context });
  if (result.ok) return;
  throw new AppError("invalid_input", result.message, {
    fieldErrors: { password: [result.message] },
    detail: { problem: result.problem },
  });
}
