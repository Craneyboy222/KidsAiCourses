import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { env } from "@/env";
import { SIGNED_OUT_STATUSES, STAFF_SESSION_SECONDS, getAuth } from "@/server/auth/auth";
import {
  ANONYMOUS,
  type Actor,
  type LearnerActor,
  type ParentActor,
  type StaffActor,
  systemActor,
} from "@/server/authz/actor";
import { db, type Db } from "@/server/db/client";
import { familyMember, learnerProfile, staffRole, user } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { ageFromBirth, safetyBandForAge, stricterBand } from "@/server/services/age";

/**
 * The request context every service receives (docs/CONVENTIONS.md "Services").
 * `actor` is who is asking, resolved once per request; `now` is the clock for the whole request.
 */
export type Ctx<A extends Actor = Actor> = {
  db: Db;
  actor: A;
  now: Date;
  requestId: string;
  ip?: string;
};

type SessionInfo = {
  userId: string;
  createdAt: Date;
  twoFactorVerified: boolean;
};

/** The first address in `x-forwarded-for` (set by the platform's proxy), else `x-real-ip`. */
function clientIp(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || undefined;
}

function requestIdFrom(headers: Headers): string {
  const given = headers.get("x-request-id")?.trim();
  // Accept a caller's id only if it is short and plain, so it is always safe to log.
  return given && /^[\w.:-]{8,100}$/.test(given) ? given : randomUUID();
}

/**
 * Builds the Actor for a signed-in user. Anything that does not add up — an unknown kind, a
 * learner without a profile, a parent without a family, a stored age under 13 — resolves to
 * anonymous: deny by default.
 */
export async function loadActor(database: Db, info: SessionInfo, now: Date): Promise<Actor> {
  const rows = await database
    .select({
      id: user.id,
      kind: user.kind,
      status: user.status,
      twoFactorEnabled: user.twoFactorEnabled,
      familyId: familyMember.familyId,
      birthYear: learnerProfile.birthYear,
      birthMonth: learnerProfile.birthMonth,
      storedBand: learnerProfile.safetyBand,
    })
    .from(user)
    .leftJoin(familyMember, eq(familyMember.userId, user.id))
    .leftJoin(learnerProfile, eq(learnerProfile.userId, user.id))
    .where(eq(user.id, info.userId))
    .limit(1);
  const row = rows[0];
  if (!row) return ANONYMOUS;
  // Banned, deleted and locked accounts are treated as signed out.
  if (SIGNED_OUT_STATUSES.has(row.status)) return ANONYMOUS;

  switch (row.kind) {
    case "learner": {
      if (row.birthYear === null || row.birthMonth === null || row.storedBand === null) {
        logWarn("ctx.learner_without_profile", { userId: row.id });
        return ANONYMOUS;
      }
      const age = ageFromBirth(row.birthYear, row.birthMonth, now);
      const liveBand = safetyBandForAge(age);
      if (!liveBand) {
        // Should be impossible: under-13s are stopped at sign-up. Never serve them.
        logWarn("ctx.learner_under_13", { userId: row.id });
        return ANONYMOUS;
      }
      const actor: LearnerActor = {
        type: "learner",
        userId: row.id,
        familyId: row.familyId,
        // The stored band is refreshed by a daily job. Until it catches up, take the stricter of the two.
        safetyBand: stricterBand(liveBand, row.storedBand),
        age,
        status: row.status,
      };
      return actor;
    }

    case "parent": {
      if (!row.familyId) {
        logWarn("ctx.parent_without_family", { userId: row.id });
        return ANONYMOUS;
      }
      const actor: ParentActor = {
        type: "parent",
        userId: row.id,
        familyId: row.familyId,
        status: row.status,
      };
      return actor;
    }

    case "staff": {
      // Only `active` staff may act at all. Their sessions end 12 hours after sign-in, whatever was refreshed.
      if (row.status !== "active") return ANONYMOUS;
      if (now.getTime() - info.createdAt.getTime() > STAFF_SESSION_SECONDS * 1000) return ANONYMOUS;
      const roles = await database
        .select({ role: staffRole.role })
        .from(staffRole)
        .where(eq(staffRole.userId, row.id));
      const actor: StaffActor = {
        type: "staff",
        userId: row.id,
        roles: roles.map((r) => r.role),
        twoFactorVerified: row.twoFactorEnabled && info.twoFactorVerified,
      };
      return actor;
    }

    default:
      // `user.kind` is open text for future account types. Until the code knows a kind, it gets nothing.
      logWarn("ctx.unknown_user_kind", { userId: row.id });
      return ANONYMOUS;
  }
}

/**
 * Resolves the context from request headers. Exported for route handlers that already hold a
 * `Request` (`resolveCtx(request.headers)`) and for tests; pages and actions use `getCtx()`.
 */
export async function resolveCtx(headers: Headers, options: { now?: Date } = {}): Promise<Ctx> {
  const now = options.now ?? new Date();
  const base = { db, now, requestId: requestIdFrom(headers), ip: clientIp(headers) };

  const current = await getAuth().api.getSession({ headers });
  if (!current) return { ...base, actor: ANONYMOUS };

  const actor = await loadActor(
    db,
    {
      userId: current.user.id,
      createdAt: new Date(current.session.createdAt),
      twoFactorVerified: current.session.twoFactorVerified === true,
    },
    now,
  );
  return { ...base, actor };
}

/**
 * The context for the current request: session from the cookies, then the user row, then the Actor.
 * Anonymous when signed out. Memoised per request in Server Components.
 */
export const getCtx = cache(async (): Promise<Ctx> => {
  // Imported here, not at the top, so that jobs, scripts and tests can use this module without Next.js.
  const { headers } = await import("next/headers");
  return resolveCtx(await headers());
});

function signedIn(ctx: Ctx): Ctx<LearnerActor | ParentActor | StaffActor> {
  const { actor } = ctx;
  if (actor.type === "learner" || actor.type === "parent" || actor.type === "staff") return { ...ctx, actor };
  throw new AppError("unauthenticated", "Please sign in to carry on.");
}

/** Any signed-in learner, parent or staff member. Throws `unauthenticated` otherwise. */
export async function requireSession(): Promise<Ctx<LearnerActor | ParentActor | StaffActor>> {
  return signedIn(await getCtx());
}

export async function requireLearner(): Promise<Ctx<LearnerActor>> {
  const ctx = await requireSession();
  if (ctx.actor.type !== "learner") throw new AppError("forbidden", "That page is for learner accounts.");
  return { ...ctx, actor: ctx.actor };
}

export async function requireParent(): Promise<Ctx<ParentActor>> {
  const ctx = await requireSession();
  if (ctx.actor.type !== "parent")
    throw new AppError("forbidden", "That page is for parent and carer accounts.");
  return { ...ctx, actor: ctx.actor };
}

/**
 * Staff only. When `STAFF_2FA_REQUIRED` is on (the default), the session must have passed the
 * second factor: a password alone is not enough to open Studio.
 */
export async function requireStaff(): Promise<Ctx<StaffActor>> {
  const ctx = await requireSession();
  if (ctx.actor.type !== "staff") throw new AppError("forbidden", "You don't have permission to do that.");
  return { ...ctx, actor: assertStaffSecondFactor(ctx.actor) };
}

/** Exported so it can be tested without a request. */
export function assertStaffSecondFactor(
  actor: StaffActor,
  required: boolean = env.STAFF_2FA_REQUIRED,
): StaffActor {
  if (required && !actor.twoFactorVerified) {
    throw new AppError(
      "two_factor_required",
      "Studio needs your two-step code. Set up two-step sign-in, or sign in again and enter your code.",
    );
  }
  return actor;
}

/** Context for a background job or script. `job` is the registered job name; it appears in the audit log. */
export function systemCtx(job: string, options: { now?: Date } = {}): Ctx {
  return {
    db,
    actor: systemActor(job),
    now: options.now ?? new Date(),
    requestId: `job:${job}:${randomUUID()}`,
  };
}
