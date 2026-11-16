import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/**
 * Liveness check for uptime monitors and deploy checks. Says only whether the app and its
 * database answer: no version, no configuration, nothing secret, and nothing cached.
 */
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

async function databaseAnswers(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
    });
    await Promise.race([db.execute(sql`select 1`), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const up = await databaseAnswers();
  return Response.json(
    { status: up ? "ok" : "degraded", time: new Date().toISOString(), db: up ? "ok" : "down" },
    { status: up ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
