import { NextResponse } from "next/server";
import { toActionError } from "./action";
import { isAppError } from "./errors";

type Handler<A extends unknown[]> = (req: Request, ...args: A) => Promise<Response | object | null | undefined>;

/**
 * Wraps a Route Handler. Returns JSON, and turns any thrown error into
 * `{ error: { code, message } }` with a message that is safe to show a teenager.
 */
export function handle<A extends unknown[]>(fn: Handler<A>) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      const out = await fn(req, ...args);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const { code, message, fieldErrors } = toActionError(e);
      const status = isAppError(e) ? e.status : code === "invalid_input" ? 422 : 500;
      return NextResponse.json({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }, { status });
    }
  };
}

export function json<T>(data: T, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}
