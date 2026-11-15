/** Error codes shared by services, actions and API handlers. */
export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "rate_limited"
  | "age_blocked"
  | "age_restricted"
  | "consent_required"
  | "parent_approval_required"
  | "tool_blocked"
  | "entitlement_required"
  | "paused"
  | "time_cap_reached"
  | "quiet_hours"
  | "credits_exhausted"
  | "ai_unavailable"
  | "moderation_blocked"
  | "validation_failed"
  | "approval_required"
  | "two_factor_required"
  | "unsafe_url"
  | "upload_rejected"
  | "budget_exceeded"
  | "not_ready"
  | "internal";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 422,
  conflict: 409,
  rate_limited: 429,
  age_blocked: 403,
  age_restricted: 403,
  consent_required: 403,
  parent_approval_required: 403,
  tool_blocked: 403,
  entitlement_required: 402,
  paused: 403,
  time_cap_reached: 403,
  quiet_hours: 403,
  credits_exhausted: 402,
  ai_unavailable: 503,
  moderation_blocked: 422,
  validation_failed: 422,
  approval_required: 409,
  two_factor_required: 403,
  unsafe_url: 422,
  upload_rejected: 422,
  budget_exceeded: 409,
  not_ready: 409,
  internal: 500,
};

/**
 * `message` is shown to users, including teenagers: say what happened and what to try.
 * Put diagnostic detail in `detail`, which is logged but never sent to the browser.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: unknown;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { status?: number; detail?: unknown; fieldErrors?: Record<string, string[]> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? DEFAULT_STATUS[code];
    this.detail = opts.detail;
    this.fieldErrors = opts.fieldErrors;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export const notFound = (what = "That") => new AppError("not_found", `${what} could not be found. It may have been moved or removed.`);
export const forbidden = (message = "You don't have permission to do that.") => new AppError("forbidden", message);
