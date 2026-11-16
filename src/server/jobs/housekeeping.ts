import { lt, or } from "drizzle-orm";
import { session, verification } from "@/server/db";
import { releaseDueEmails } from "@/server/notifications";
import { deleteExpiredRateLimitBuckets } from "@/server/ratelimit";
import { defineJob } from "./define";

/** Housekeeping jobs owned by the kernel. Each is safe to run at any time and as often as you like. */

/**
 * In-app notifications need no job: a notification held back for quiet hours simply becomes
 * visible when `deliver_after` passes (the list and the unread count check it). Emails cannot
 * work that way, so this sends the ones whose quiet-hours wait is over (18-year-old learners only;
 * younger learners are never emailed).
 */
export const notificationsRelease = defineJob({
  name: "notifications.release",
  schedule: "*/10 * * * *",
  event: "notifications/release",
  run: async (ctx) => releaseDueEmails(ctx),
});

/** Deletes rate-limit windows that have ended. */
export const rateLimitCleanup = defineJob({
  name: "ratelimit.cleanup",
  schedule: "20 * * * *",
  run: async (ctx) => ({ deleted: await deleteExpiredRateLimitBuckets(ctx) }),
});

/** Deletes sessions past their expiry or their hard ceiling, and used-up verification tokens. */
export const sessionsCleanup = defineJob({
  name: "sessions.cleanup",
  schedule: "40 3 * * *",
  run: async (ctx) => {
    const sessions = await ctx.db
      .delete(session)
      .where(or(lt(session.expiresAt, ctx.now), lt(session.absoluteExpiresAt, ctx.now)))
      .returning({ id: session.id });
    const verifications = await ctx.db
      .delete(verification)
      .where(lt(verification.expiresAt, ctx.now))
      .returning({ id: verification.id });
    return { sessions: sessions.length, verifications: verifications.length };
  },
});
