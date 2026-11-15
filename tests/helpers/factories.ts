import { randomBytes, randomUUID } from "node:crypto";
import { londonDateKey, londonYearMonth } from "@/lib/dates";
import { createAccount, type UserRow } from "@/server/auth/accounts";
import type { LearnerActor, ParentActor, StaffActor, StaffRole, UserStatus } from "@/server/authz/actor";
import { db as rootDb, type Db } from "@/server/db/client";
import {
  consentDefinition,
  consentRecord,
  family,
  familyMember,
  inviteCode,
  learnerProfile,
  parentControl,
  parentLinkRequest,
  staffRole,
  usageDay,
} from "@/server/db/schema";
import { ageFromBirth, pathwayForAge, safetyBandForAge } from "@/server/services/age";

/**
 * Test factories. Each returns the rows it created plus a ready-made `Actor`:
 *
 *   const { family, actor: parent } = await createParent();
 *   const { user, actor: learner } = await createLearner({ age: 14, familyId: family.id });
 *   const ctx = testCtx(learner);
 *
 * Accounts go through `createAccount`, the same function the real sign-up services use. No
 * password is set unless you pass one (hashing is slow), so pass `password` only when a test
 * signs in for real.
 */

export type FamilyRow = typeof family.$inferSelect;
export type LearnerProfileRow = typeof learnerProfile.$inferSelect;

/** A password that passes the policy, for tests that sign in. */
export const TEST_PASSWORD = "orbit-lantern-walrus-42";

const unique = () => randomBytes(5).toString("hex");

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Factory insert returned no ${what} row`);
  return row;
}

// ── Families and parents ────────────────────────────────────────────────────

export type CreateParentInput = {
  /** Join an existing family as a second parent or carer. Omit to start a new family owned by this parent. */
  familyId?: string;
  email?: string;
  name?: string;
  status?: UserStatus;
  password?: string;
  emailVerified?: boolean;
  plan?: string;
};

export async function createParent(
  input: CreateParentInput = {},
  database: Db = rootDb,
): Promise<{ user: UserRow; family: FamilyRow; actor: ParentActor }> {
  const parent = await createAccount(database, {
    kind: "parent",
    name: input.name ?? "Priya Parent",
    email: input.email ?? `parent-${unique()}@example.test`,
    status: input.status ?? "active",
    password: input.password,
    emailVerified: input.emailVerified ?? true,
  });

  let familyRow: FamilyRow;
  if (input.familyId) {
    const existing = await database.query.family.findFirst({
      where: (f, { eq }) => eq(f.id, input.familyId ?? ""),
    });
    if (!existing) throw new Error(`createParent: family ${input.familyId} does not exist`);
    familyRow = existing;
  } else {
    familyRow = one(
      await database
        .insert(family)
        .values({ ownerUserId: parent.id, plan: input.plan ?? "free" })
        .returning(),
      "family",
    );
  }
  await database.insert(familyMember).values({ familyId: familyRow.id, userId: parent.id, role: "parent" });

  return {
    user: parent,
    family: familyRow,
    actor: { type: "parent", userId: parent.id, familyId: familyRow.id, status: parent.status },
  };
}

/** A new family with its owning parent. */
export async function createFamily(
  input: Omit<CreateParentInput, "familyId"> = {},
  database: Db = rootDb,
): Promise<{ family: FamilyRow; parent: UserRow; parentActor: ParentActor }> {
  const created = await createParent(input, database);
  return { family: created.family, parent: created.user, parentActor: created.actor };
}

// ── Learners ────────────────────────────────────────────────────────────────

export type CreateLearnerInput = {
  /** Age in whole years, as `ageFromBirth` will report it at `now`. Default 14. Ignored if a birth month and year are given. */
  age?: number;
  birthYear?: number;
  birthMonth?: number;
  /** Omit for a teen-first account that has no family yet (`familyId: null` on the Actor). */
  familyId?: string | null;
  status?: UserStatus;
  username?: string;
  nickname?: string;
  password?: string;
  interests?: string[];
  /** The clock used to turn `age` into a birth month and year, and to work out the Actor's age. Default: now. */
  now?: Date;
};

/**
 * A birth month and year that give exactly `age` at `now`, six months away from the nearest
 * birthday boundary so that a test does not change its answer when the month rolls over.
 */
export function birthForAge(age: number, now: Date = new Date()): { birthYear: number; birthMonth: number } {
  const { year, month } = londonYearMonth(now);
  // Month later than the birth month: the birthday has certainly passed this year.
  return month > 6
    ? { birthYear: year - age, birthMonth: month - 6 }
    : { birthYear: year - age - 1, birthMonth: month + 6 };
}

export async function createLearner(
  input: CreateLearnerInput = {},
  database: Db = rootDb,
): Promise<{ user: UserRow; profile: LearnerProfileRow; actor: LearnerActor }> {
  const now = input.now ?? new Date();
  const birth =
    input.birthYear !== undefined && input.birthMonth !== undefined
      ? { birthYear: input.birthYear, birthMonth: input.birthMonth }
      : birthForAge(input.age ?? 14, now);
  const age = ageFromBirth(birth.birthYear, birth.birthMonth, now);
  const safetyBand = safetyBandForAge(age);
  const pathway = pathwayForAge(age);
  if (!safetyBand || !pathway) {
    throw new Error(
      `createLearner: that birth date gives age ${age}. Under-13s cannot have an account, so there is nothing to create.`,
    );
  }

  const nickname = input.nickname ?? "Maya";
  const learner = await createAccount(database, {
    kind: "learner",
    name: nickname,
    username: input.username ?? `learner_${unique()}`,
    status: input.status ?? "active",
    password: input.password,
  });
  const profile = one(
    await database
      .insert(learnerProfile)
      .values({
        userId: learner.id,
        birthYear: birth.birthYear,
        birthMonth: birth.birthMonth,
        safetyBand,
        pathway,
        nickname,
        avatarSeed: `seed-${unique()}`,
        interests: input.interests ?? ["music", "games", "apps"],
      })
      .returning(),
    "learner_profile",
  );
  const familyId = input.familyId ?? null;
  if (familyId) await database.insert(familyMember).values({ familyId, userId: learner.id, role: "learner" });

  return {
    user: learner,
    profile,
    actor: { type: "learner", userId: learner.id, familyId, safetyBand, age, status: learner.status },
  };
}

// ── Staff ───────────────────────────────────────────────────────────────────

export type CreateStaffInput = {
  roles?: StaffRole[];
  email?: string;
  name?: string;
  status?: UserStatus;
  password?: string;
  /** What the Actor says about the second factor. Default true, so `assertCan` works out of the box. */
  twoFactorVerified?: boolean;
};

export async function createStaff(
  input: CreateStaffInput = {},
  database: Db = rootDb,
): Promise<{ user: UserRow; actor: StaffActor }> {
  const roles = input.roles ?? ["editor"];
  const staff = await createAccount(database, {
    kind: "staff",
    name: input.name ?? "Sam Staff",
    email: input.email ?? `staff-${unique()}@example.test`,
    status: input.status ?? "active",
    password: input.password,
    emailVerified: true,
  });
  if (roles.length > 0) {
    await database.insert(staffRole).values(roles.map((role) => ({ userId: staff.id, role })));
  }
  return {
    user: staff,
    actor: { type: "staff", userId: staff.id, roles, twoFactorVerified: input.twoFactorVerified ?? true },
  };
}

// ── The rest of the identity tables ─────────────────────────────────────────

export async function createInviteCode(
  input: { familyId: string; learnerId: string; createdBy?: string; expiresAt?: Date },
  database: Db = rootDb,
) {
  return one(
    await database
      .insert(inviteCode)
      .values({
        familyId: input.familyId,
        learnerId: input.learnerId,
        codeHash: `hash-${randomUUID()}`,
        expiresAt: input.expiresAt ?? new Date(Date.now() + 72 * 60 * 60 * 1000),
        createdBy: input.createdBy,
      })
      .returning(),
    "invite_code",
  );
}

export async function createParentLinkRequest(
  input: { learnerId: string; parentEmail?: string; expiresAt?: Date },
  database: Db = rootDb,
) {
  return one(
    await database
      .insert(parentLinkRequest)
      .values({
        learnerId: input.learnerId,
        parentEmail: input.parentEmail ?? `parent-${unique()}@example.test`,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning(),
    "parent_link_request",
  );
}

export async function createConsentDefinition(
  input: { key?: string; version?: number; required?: boolean; defaultByBand?: Record<string, boolean> } = {},
  database: Db = rootDb,
) {
  const key = input.key ?? `consent_${unique()}`;
  return one(
    await database
      .insert(consentDefinition)
      .values({
        key,
        version: input.version ?? 1,
        title: `Consent: ${key}`,
        body: "Plain-English explanation of what this consent covers.",
        required: input.required ?? true,
        defaultByBand: input.defaultByBand ?? {},
      })
      .returning(),
    "consent_definition",
  );
}

/** Appends a consent record. There is no update: to change a consent, record again. */
export async function recordConsent(
  input: {
    learnerId: string;
    actorUserId: string;
    familyId?: string | null;
    consentKey: string;
    consentVersion?: number;
    action?: "granted" | "revoked";
  },
  database: Db = rootDb,
) {
  return one(
    await database
      .insert(consentRecord)
      .values({
        learnerId: input.learnerId,
        actorUserId: input.actorUserId,
        familyId: input.familyId ?? null,
        consentKey: input.consentKey,
        consentVersion: input.consentVersion ?? 1,
        action: input.action ?? "granted",
      })
      .returning(),
    "consent_record",
  );
}

export async function createParentControl(
  input: { learnerId: string; familyId: string } & Partial<typeof parentControl.$inferInsert>,
  database: Db = rootDb,
) {
  return one(await database.insert(parentControl).values(input).returning(), "parent_control");
}

export async function createUsageDay(
  input: { learnerId: string; day?: string; seconds?: number },
  database: Db = rootDb,
) {
  return one(
    await database
      .insert(usageDay)
      .values({
        learnerId: input.learnerId,
        day: input.day ?? londonDateKey(new Date()),
        seconds: input.seconds ?? 0,
      })
      .returning(),
    "usage_day",
  );
}
