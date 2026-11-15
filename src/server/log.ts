/**
 * Structured logging. Never pass learner free text, message content, passwords or tokens.
 * Values under keys that look secret are redacted as a second line of defence.
 */
const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|otp|code)$/i;

function scrub(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 6).join("\n") };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrub(v, depth + 1);
  return out;
}

function write(level: "info" | "warn" | "error", event: string, data?: unknown) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...(data === undefined ? {} : { data: scrub(data) }) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logInfo = (event: string, data?: unknown) => write("info", event, data);
export const logWarn = (event: string, data?: unknown) => write("warn", event, data);
export const logError = (event: string, error?: unknown, data?: unknown) =>
  write("error", event, { error: error instanceof Error ? error : String(error), ...(data && typeof data === "object" ? data : {}) });
