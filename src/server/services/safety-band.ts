import { and, eq, ne } from "drizzle-orm";
import { env } from "@/env";
import { SAFETY_BANDS, type Pathway, type SafetyBand } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { family, familyMember, learnerProfile, user } from "@/server/db";
import { logWarn } from "@/server/log";
import { notify, notifyParentsOfLearner } from "@/server/notifications";
import { ageFromBirth, pathwayForAge, safetyBandForAge } from "./age";

/**
 * The daily age check (spec 2 and 3.1; job `accounts.recalculate_bands`).
 *
 * `safety_band` and the default `pathway` are derived from the birth month and year, which is all
 * we hold. A birthday only counts once the birth month is completely over (decision D13), so a
 * learner is never moved up early. When a learner moves into a new age group their parents are
 * told (in the app and by email) and the learner is told in the app. At 18 the learner is offered
 * the chance to run their own account; nothing changes unless they take it up.
 */

export type BandUpdate = {
  age: number;
  /** Null when the birth date now gives an age under 13, which should be impossible. Nothing is changed. */
  safetyBand: SafetyBand | null;
  pathway: Pathway | null;
  bandChanged: boolean;
  /** Moved to an older group (the usual case: a birthday). */
  movedUp: boolean;
  pathwayChanged: boolean;
};

/** Pure: what a profile's band and pathway should be today, and whether that is a change. */
export function bandUpdateFor(profile: { birthYear: number; birthMonth: number; safetyBand: SafetyBand; pathway: Pathway }, now: Date): BandUpdate {
  const age = ageFromBirth(profile.birthYear, profile.birthMonth, now);
  const safetyBand = safetyBandForAge(age);
  const pathway = pathwayForAge(age);
  if (!safetyBand || !pathway) return { age, safetyBand: null, pathway: null, bandChanged: false, movedUp: false, pathwayChanged: false };
  return {
    age,
    safetyBand,
    pathway,
    bandChanged: safetyBand !== profile.safetyBand,
    movedUp: SAFETY_BANDS.indexOf(safetyBand) > SAFETY_BANDS.indexOf(profile.safetyBand),
    pathwayChanged: pathway !== profile.pathway,
  };
}

const PARENT_CHANGE: Record<Exclude<SafetyBand, "teen_13_15">, string> = {
  teen_16_17:
    "They are now in the 16 to 17 age group. Courses and tools with a minimum age of 16 can now appear for them, and the optional privacy choices you made stay exactly as they are. You are still linked as their parent or carer, and your time limits, quiet hours and approvals carry on as before.",
  adult_18:
    "They are now 18. We have told them that they can choose to run their own account, with their own email address. Nothing changes unless they decide to do that, and we will let you know if they do.",
};

const LEARNER_NOTICE: Record<Exclude<SafetyBand, "teen_13_15">, { title: string; body: string; href: string }> = {
  teen_16_17: {
    title: "You've moved up an age group",
    body: "You're now in the 16 to 17 group, so some courses and tools with a higher minimum age have opened up. Your parent or carer's settings stay the same.",
    href: "/explore",
  },
  adult_18: {
    title: "You're 18: your account, your call",
    body: "You can now take over your own account with your own email address. Nothing changes unless you choose to. Have a look when you're ready.",
    href: "/settings/independence",
  },
};

export type RecalculateResult = {
  checked: number;
  bandChanged: number;
  pathwayChanged: number;
  independenceOffered: number;
  /** Profiles whose birth date gives an age under 13. They are left alone and logged for a person to look at. */
  under13: number;
};

/** Recomputes every learner's band and pathway, and sends the birthday notices. Safe to run twice. */
export async function recalculateBands(ctx: Pick<Ctx, "db" | "now">): Promise<RecalculateResult> {
  const result: RecalculateResult = { checked: 0, bandChanged: 0, pathwayChanged: 0, independenceOffered: 0, under13: 0 };
  const rows = await ctx.db
    .select({
      learnerId: user.id,
      nickname: learnerProfile.nickname,
      birthYear: learnerProfile.birthYear,
      birthMonth: learnerProfile.birthMonth,
      safetyBand: learnerProfile.safetyBand,
      pathway: learnerProfile.pathway,
      independenceOfferedAt: learnerProfile.independenceOfferedAt,
      familyOwnerId: family.ownerUserId,
    })
    .from(learnerProfile)
    .innerJoin(user, eq(user.id, learnerProfile.userId))
    .leftJoin(familyMember, eq(familyMember.userId, user.id))
    .leftJoin(family, eq(family.id, familyMember.familyId))
    .where(and(eq(user.kind, "learner"), ne(user.status, "deleted")));

  for (const row of rows) {
    result.checked += 1;
    const update = bandUpdateFor(row, ctx.now);
    if (!update.safetyBand || !update.pathway) {
      result.under13 += 1;
      logWarn("accounts.band.under_13_profile", { userId: row.learnerId });
      continue;
    }
    // Someone who owns their family signed up as an adult, or has already taken over: nothing to offer.
    const ownsFamily = row.familyOwnerId === row.learnerId;
    const offerIndependence = update.safetyBand === "adult_18" && row.independenceOfferedAt === null && !ownsFamily;

    await ctx.db
      .update(learnerProfile)
      .set({
        safetyBand: update.safetyBand,
        pathway: update.pathway,
        safetyBandCheckedAt: ctx.now,
        ...(offerIndependence ? { independenceOfferedAt: ctx.now } : {}),
        ...(update.bandChanged || update.pathwayChanged || offerIndependence ? { updatedAt: ctx.now } : {}),
      })
      .where(eq(learnerProfile.userId, row.learnerId));
    if (update.bandChanged) result.bandChanged += 1;
    if (update.pathwayChanged) result.pathwayChanged += 1;
    if (offerIndependence) result.independenceOffered += 1;

    const band = update.safetyBand;
    if (band === "teen_13_15") continue;
    if (!(update.movedUp || offerIndependence)) continue;
    try {
      const dedupeKey = `band:${row.learnerId}:${band}`;
      const learnerNotice = LEARNER_NOTICE[band];
      await notify(ctx, { userId: row.learnerId, type: "account.birthday_transition", ...learnerNotice, channels: ["in_app"], dedupeKey });
      if (!ownsFamily) {
        await notifyParentsOfLearner(ctx, row.learnerId, {
          type: "account.birthday_transition",
          title: `${row.nickname}'s settings are changing`,
          body: PARENT_CHANGE[band],
          href: "/parent",
          emailTemplate: "birthday_transition",
          emailData: { childName: row.nickname, change: PARENT_CHANGE[band], url: `${env.NEXT_PUBLIC_APP_URL}/parent` },
          dedupeKey,
        });
      }
    } catch (error) {
      // A failed notice must not stop the other learners being checked. The dedupe key makes a retry safe.
      logWarn("accounts.band.notice_failed", { userId: row.learnerId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
