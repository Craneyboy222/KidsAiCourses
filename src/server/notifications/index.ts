import { and, count, desc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { env } from "@/env";
import { formatDate, formatTime } from "@/lib/dates";
import { userEmail } from "@/server/auth/learner-email";
import { setAccountLockedHandler, type AccountLockedEvent } from "@/server/auth/lockout";
import { actorUserId, assertCan, type StaffRole } from "@/server/authz";
import { systemCtx, type Ctx } from "@/server/context";
import { familyMember, learnerProfile, notification, parentControl, staffRole, user } from "@/server/db";
import { EmailRefusedError, sendEmail } from "@/server/email/send";
import type { TemplateData } from "@/server/email/render";
import { AppError } from "@/server/errors";
import { logError, logWarn } from "@/server/log";
import { ageFromBirth, safetyBandForAge, stricterBand } from "@/server/services/age";
import { getSetting } from "@/server/settings/store";
import { effectiveQuietWindow, quietHoursDeliverAfter } from "./quiet-hours";

export * from "./quiet-hours";

/**
 * In-app and email notifications (spec 3.10).
 *
 * The rules, enforced here so that no caller has to remember them:
 * - A learner under 18 is told things in the app only. They never get an email.
 * - An 18-year-old learner may also get an email, if they have given an address.
 * - Nothing reaches a learner during their quiet hours (set by a parent, else the site default).
 *   It is stored with `deliver_after` set to the end of the window and is not shown, counted or
 *   emailed until then. `urgent` does not override a parent's quiet hours.
 * - Parents and staff have no quiet hours, so a safety notice to a parent is always immediate.
 * - `type` is open text (`safety_notice.account_locked`, `unlock.requested`, …): add new ones freely.
 *
 * `title` and `body` are written by us, never copied from something a learner typed.
 */
export type NotificationChannel = "in_app" | "email";

export type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  /** A path on our own site, e.g. `/parent/notices`. */
  href?: string;
  /** Default: in-app, plus email when `emailTemplate` is given. */
  channels?: NotificationChannel[];
  /** A key from the email templates. Needed for the email channel. */
  emailTemplate?: string;
  emailData?: TemplateData;
  /** Shown as important. Never overrides a learner's quiet hours. */
  urgent?: boolean;
  /** The same key never notifies the same thing twice (e.g. `unlock:<request id>`). */
  dedupeKey?: string;
};

export type EmailOutcome = "sent" | "deferred" | "failed" | "not_requested" | "not_eligible";

export type NotifyResult = {
  userId: string;
  /** The in-app row, or `null` when it was not requested or was a duplicate. */
  notificationId: string | null;
  /** When it becomes visible. `null` means it is visible now. */
  deliverAfter: Date | null;
  email: EmailOutcome;
  duplicate: boolean;
};

type Payload = {
  title: string;
  body: string;
  href: string | null;
  urgent: boolean;
  emailTemplate?: string;
  emailData?: TemplateData;
};

function assertHref(href: string | undefined): string | null {
  if (href === undefined) return null;
  // Our own paths only: a notification must never be a way to send someone to another site.
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\r\n]/.test(href)) {
    throw new Error(`notify(): href must be a path on this site, got "${href.slice(0, 80)}"`);
  }
  return href;
}

type Recipient = {
  id: string;
  kind: string;
  email: string | null;
  isLearner: boolean;
  isAdultLearner: boolean;
  quiet: { quietStartMin: number | null; quietEndMin: number | null } | null;
};

async function loadRecipient(ctx: Pick<Ctx, "db" | "now">, userId: string): Promise<Recipient | null> {
  const rows = await ctx.db
    .select({
      id: user.id,
      kind: user.kind,
      status: user.status,
      email: user.email,
      birthYear: learnerProfile.birthYear,
      birthMonth: learnerProfile.birthMonth,
      storedBand: learnerProfile.safetyBand,
      controlId: parentControl.id,
      quietStartMin: parentControl.quietStartMin,
      quietEndMin: parentControl.quietEndMin,
    })
    .from(user)
    .leftJoin(learnerProfile, eq(learnerProfile.userId, user.id))
    .leftJoin(parentControl, eq(parentControl.learnerId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row || row.status === "deleted") return null;
  // Anything that is not plainly a parent or staff account gets the learner rules.
  const isLearner = row.kind !== "parent" && row.kind !== "staff";
  let isAdultLearner = false;
  if (isLearner && row.birthYear !== null && row.birthMonth !== null && row.storedBand !== null) {
    const live = safetyBandForAge(ageFromBirth(row.birthYear, row.birthMonth, ctx.now));
    isAdultLearner = live !== null && stricterBand(live, row.storedBand) === "adult_18";
  }
  return {
    id: row.id,
    kind: row.kind,
    email: userEmail(row),
    isLearner,
    isAdultLearner,
    quiet: row.controlId ? { quietStartMin: row.quietStartMin, quietEndMin: row.quietEndMin } : null,
  };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

async function deliverEmail(
  ctx: Pick<Ctx, "db" | "now">,
  rowId: string,
  to: string,
  userId: string,
  template: string,
  data: TemplateData | undefined,
): Promise<EmailOutcome> {
  try {
    await sendEmail(ctx, { to, userId, template, data });
    await ctx.db
      .update(notification)
      .set({ sentAt: ctx.now, failedAt: null, error: null, updatedAt: ctx.now })
      .where(eq(notification.id, rowId));
    return "sent";
  } catch (error) {
    await ctx.db
      .update(notification)
      .set({ sentAt: null, failedAt: ctx.now, error: errorText(error), updatedAt: ctx.now })
      .where(eq(notification.id, rowId));
    if (error instanceof EmailRefusedError) {
      logWarn("notify.email_refused", { userId, template, reason: error.reason });
      return "not_eligible";
    }
    // The in-app notice is already stored, so the person is still told. Never fail the caller's work over an email.
    logError("notify.email_failed", error, { userId, template });
    return "failed";
  }
}

/** Tells one person something, in the app and (where the rules allow) by email. */
export async function notify(ctx: Pick<Ctx, "db" | "now">, input: NotifyInput): Promise<NotifyResult> {
  const href = assertHref(input.href);
  const channels = new Set<NotificationChannel>(
    input.channels ?? (input.emailTemplate ? ["in_app", "email"] : ["in_app"]),
  );
  const result: NotifyResult = {
    userId: input.userId,
    notificationId: null,
    deliverAfter: null,
    email: "not_requested",
    duplicate: false,
  };

  const recipient = await loadRecipient(ctx, input.userId);
  if (!recipient) {
    logWarn("notify.unknown_user", { userId: input.userId, type: input.type });
    return result;
  }

  let deliverAfter: Date | null = null;
  if (recipient.isLearner) {
    const window = effectiveQuietWindow(recipient.quiet, await getSetting(ctx, "site.default_quiet_hours"));
    deliverAfter = quietHoursDeliverAfter(ctx.now, window);
  }
  result.deliverAfter = deliverAfter;

  const payload: Payload = { title: input.title, body: input.body, href, urgent: input.urgent === true };

  if (channels.has("in_app")) {
    const rows = await ctx.db
      .insert(notification)
      .values({
        userId: recipient.id,
        type: input.type,
        channel: "in_app",
        payload,
        deliverAfter,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:in_app` : null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing({ target: notification.dedupeKey })
      .returning({ id: notification.id });
    if (!rows[0]) {
      result.duplicate = true;
      return result;
    }
    result.notificationId = rows[0].id;
  }

  if (!channels.has("email")) return result;
  if (!input.emailTemplate)
    throw new Error(`notify(): the email channel needs an emailTemplate (type "${input.type}")`);
  // Under-18 learners never get email; and nobody can be emailed without an address.
  if ((recipient.isLearner && !recipient.isAdultLearner) || !recipient.email) {
    result.email = "not_eligible";
    return result;
  }

  const emailRows = await ctx.db
    .insert(notification)
    .values({
      userId: recipient.id,
      type: input.type,
      channel: "email",
      payload: { ...payload, emailTemplate: input.emailTemplate, emailData: input.emailData ?? {} },
      deliverAfter,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:email` : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning({ id: notification.id });
  const emailRow = emailRows[0];
  if (!emailRow) {
    result.duplicate = true;
    return result;
  }
  if (deliverAfter) {
    // An adult learner inside quiet hours: the `notifications.release` job sends it when the window ends.
    result.email = "deferred";
    return result;
  }
  result.email = await deliverEmail(
    ctx,
    emailRow.id,
    recipient.email,
    recipient.id,
    input.emailTemplate,
    input.emailData,
  );
  return result;
}

/** Everything about a notification except who it is for. */
export type NotifyManyInput = Omit<NotifyInput, "userId">;

function perRecipient(input: NotifyManyInput, userId: string): NotifyInput {
  return { ...input, userId, ...(input.dedupeKey ? { dedupeKey: `${input.dedupeKey}:${userId}` } : {}) };
}

/** Tells every parent or carer in the learner's family. A learner with no family yet has nobody to tell: returns `[]`. */
export async function notifyParentsOfLearner(
  ctx: Pick<Ctx, "db" | "now">,
  learnerId: string,
  input: NotifyManyInput,
): Promise<NotifyResult[]> {
  const [membership] = await ctx.db
    .select({ familyId: familyMember.familyId })
    .from(familyMember)
    .where(eq(familyMember.userId, learnerId))
    .limit(1);
  if (!membership) return [];
  const parents = await ctx.db
    .select({ userId: familyMember.userId })
    .from(familyMember)
    .innerJoin(user, eq(user.id, familyMember.userId))
    .where(
      and(
        eq(familyMember.familyId, membership.familyId),
        eq(familyMember.role, "parent"),
        notInArray(user.status, ["deleted", "banned"]),
      ),
    );
  const results: NotifyResult[] = [];
  for (const parent of parents) results.push(await notify(ctx, perRecipient(input, parent.userId)));
  return results;
}

/** Tells every active member of staff who holds the role (or any of the roles). */
export async function notifyStaffWithRole(
  ctx: Pick<Ctx, "db" | "now">,
  role: StaffRole | StaffRole[],
  input: NotifyManyInput,
): Promise<NotifyResult[]> {
  const roles = Array.isArray(role) ? role : [role];
  if (roles.length === 0) return [];
  const staff = await ctx.db
    .selectDistinct({ userId: staffRole.userId })
    .from(staffRole)
    .innerJoin(user, eq(user.id, staffRole.userId))
    .where(and(inArray(staffRole.role, roles), eq(user.kind, "staff"), eq(user.status, "active")));
  const results: NotifyResult[] = [];
  for (const member of staff) results.push(await notify(ctx, perRecipient(input, member.userId)));
  return results;
}

// ── Reading ─────────────────────────────────────────────────────────────────

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  urgent: boolean;
  read: boolean;
  /** When it became visible: the end of quiet hours for one that waited, otherwise when it was raised. */
  at: Date;
};

/** People read their own notifications. Support staff may look at someone else's (`user.read`). */
function assertMayRead(ctx: Pick<Ctx, "actor">, userId: string): void {
  const { actor } = ctx;
  if (actor.type === "system") return;
  if (actorUserId(actor) === userId) {
    if (actor.type === "learner") assertCan(actor, "learner.notification.read", { learnerId: userId });
    return;
  }
  if (actor.type === "staff") return assertCan(actor, "user.read");
  if (actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  throw new AppError("forbidden", "You can only see your own notifications.");
}

const visibleTo = (userId: string, now: Date) =>
  and(
    eq(notification.userId, userId),
    eq(notification.channel, "in_app"),
    or(isNull(notification.deliverAfter), lte(notification.deliverAfter, now)),
  );

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

/** Newest first. Notifications still waiting for quiet hours to end are left out. */
export async function listNotifications(
  ctx: Pick<Ctx, "db" | "now" | "actor">,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationItem[]> {
  assertMayRead(ctx, userId);
  const rows = await ctx.db
    .select()
    .from(notification)
    .where(and(visibleTo(userId, ctx.now), options.unreadOnly ? isNull(notification.readAt) : undefined))
    .orderBy(
      desc(sql`coalesce(${notification.deliverAfter}, ${notification.createdAt})`),
      desc(notification.createdAt),
    )
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: text(row.payload.title),
    body: text(row.payload.body),
    href: typeof row.payload.href === "string" ? row.payload.href : null,
    urgent: row.payload.urgent === true,
    read: row.readAt !== null,
    at: row.deliverAfter ?? row.createdAt,
  }));
}

export async function unreadCount(ctx: Pick<Ctx, "db" | "now" | "actor">, userId: string): Promise<number> {
  assertMayRead(ctx, userId);
  const rows = await ctx.db
    .select({ n: count() })
    .from(notification)
    .where(and(visibleTo(userId, ctx.now), isNull(notification.readAt)));
  return rows[0]?.n ?? 0;
}

/** Marks the given notifications, or `"all"` visible ones, as read. Only the owner can. Returns how many changed. */
export async function markRead(
  ctx: Pick<Ctx, "db" | "now" | "actor">,
  userId: string,
  ids: string[] | "all",
): Promise<number> {
  if (actorUserId(ctx.actor) !== userId)
    throw new AppError("forbidden", "You can only change your own notifications.");
  assertMayRead(ctx, userId);
  if (ids !== "all" && ids.length === 0) return 0;
  const rows = await ctx.db
    .update(notification)
    .set({ readAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        visibleTo(userId, ctx.now),
        isNull(notification.readAt),
        ids === "all" ? undefined : inArray(notification.id, ids),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}

// ── Emails that waited for quiet hours ──────────────────────────────────────

/** Sends emails whose quiet-hours wait is over. Run by the `notifications.release` job. */
export async function releaseDueEmails(
  ctx: Pick<Ctx, "db" | "now">,
  batch = 100,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const due = await ctx.db
    .select({ id: notification.id, userId: notification.userId, payload: notification.payload })
    .from(notification)
    .where(
      and(
        eq(notification.channel, "email"),
        isNull(notification.sentAt),
        isNull(notification.failedAt),
        lte(notification.deliverAfter, ctx.now),
      ),
    )
    .orderBy(notification.deliverAfter)
    .limit(batch);
  const summary = { sent: 0, failed: 0, skipped: 0 };
  for (const row of due) {
    // Claim the row first so that two runs at once cannot both send it.
    const claimed = await ctx.db
      .update(notification)
      .set({ sentAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(notification.id, row.id), isNull(notification.sentAt), isNull(notification.failedAt)))
      .returning({ id: notification.id });
    if (!claimed[0]) continue;
    const recipient = await loadRecipient(ctx, row.userId);
    const template = text(row.payload.emailTemplate);
    if (!recipient?.email || !template || (recipient.isLearner && !recipient.isAdultLearner)) {
      await ctx.db
        .update(notification)
        .set({
          sentAt: null,
          failedAt: ctx.now,
          error: "Recipient can no longer be emailed",
          updatedAt: ctx.now,
        })
        .where(eq(notification.id, row.id));
      summary.skipped += 1;
      continue;
    }
    const outcome = await deliverEmail(
      ctx,
      row.id,
      recipient.email,
      recipient.id,
      template,
      (row.payload.emailData ?? {}) as TemplateData,
    );
    if (outcome === "sent") summary.sent += 1;
    else if (outcome === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }
  return summary;
}

// ── Account lockout (spec 3.1) ──────────────────────────────────────────────

/** What happens when repeated wrong passwords lock an account. Exported for tests. */
export async function handleAccountLocked(
  event: AccountLockedEvent,
  ctx: Pick<Ctx, "db" | "now"> = systemCtx("auth.lockout"),
): Promise<NotifyResult[]> {
  const until = `${formatTime(event.lockedUntil)} on ${formatDate(event.lockedUntil)}`;
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");

  if (event.kind === "learner") {
    const [profile] = await ctx.db
      .select({ nickname: learnerProfile.nickname })
      .from(learnerProfile)
      .where(eq(learnerProfile.userId, event.userId))
      .limit(1);
    const name = profile?.nickname ?? "your child";
    // A safety notice to parents: always immediate, in the app and by email.
    return notifyParentsOfLearner(ctx, event.userId, {
      type: "safety_notice.account_locked",
      title: `Sign-in is paused on ${name}'s account`,
      body: `The wrong password was entered several times, so sign-in on ${name}'s account is paused until about ${until}. If that wasn't ${name}, you can set a new password for them from your dashboard.`,
      href: "/parent",
      urgent: true,
      emailTemplate: "account_locked",
      emailData: { accountLabel: `${name}'s account`, lockedUntil: until, url: `${appUrl}/parent` },
      dedupeKey: `lockout:${event.userId}:${event.lockedUntil.toISOString()}`,
    });
  }

  const href = event.kind === "staff" ? "/studio" : "/parent";
  return [
    await notify(ctx, {
      userId: event.userId,
      type: "safety_notice.account_locked",
      title: "Sign-in was paused on your account",
      body: `The wrong password was entered several times, so sign-in on your account was paused until about ${until}. If that wasn't you, choose a new password.`,
      href,
      urgent: true,
      emailTemplate: "account_locked",
      emailData: { accountLabel: "your account", lockedUntil: until, url: `${appUrl}${href}` },
      dedupeKey: `lockout:${event.userId}:${event.lockedUntil.toISOString()}`,
    }),
  ];
}

/** Registers the handler above with the sign-in lockout. Called once at start-up by `installKernelHooks()`. */
export function wireAccountLockedNotifications(): void {
  setAccountLockedHandler(async (event) => {
    await handleAccountLocked(event);
  });
}
