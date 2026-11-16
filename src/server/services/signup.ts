import { eq, inArray } from "drizzle-orm";
import { createAccount, normaliseEmail, type UserRow } from "@/server/auth/accounts";
import { getAuth } from "@/server/auth/auth";
import { isLearnerPlaceholderEmail } from "@/server/auth/learner-email";
import { assertPasswordAllowed } from "@/server/auth/password";
import { audit } from "@/server/audit";
import type { Pathway, SafetyBand, UserStatus } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { newToken } from "@/server/crypto";
import { family, familyMember, learnerProfile, user, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { incrementCounter } from "@/server/metrics";
import { getSetting } from "@/server/settings";
import { isSignupOpen } from "@/server/settings/launch-readiness";
import { ADULT_AGE, MINIMUM_AGE, ageFromBirth, pathwayForAge, safetyBandForAge } from "./age";
import { REQUIRED_CONSENT_KEYS, applyConsentChoices, listConsentDefinitions } from "./consent";
import { checkUsername, suggestUsernames, type UsernameContext } from "./username";

/**
 * Sign-up (spec 3.1, Section 4): the gates every new account passes, parent sign-up, and an
 * 18-year-old signing up for themselves. Teen-first sign-up is in `teen-signup.ts` and adding a
 * child is in `children.ts`; both use the gates here.
 *
 * THE UNDER-13 BLOCK. `assertOldEnough` runs before anything else is looked at, validated,
 * rate-limited or written. For someone under 13 it adds one to the anonymous
 * `signup.under13_blocked` counter and throws `age_blocked`. It takes a month and a year and
 * nothing else, so there is no way for a username, a nickname or a parent's email to reach a
 * table or a log from that path. The caller (a Server Action) then sets `AGE_GATE_COOKIE`, a flag
 * with no information in it, and sends the visitor to `/blocked-age`.
 */

/** A flag only: the value is always "1". It says "this browser was just turned away", nothing about who. */
export const AGE_GATE_COOKIE = "age_gate";
/** Long enough to stop someone trying again at once with a different date; short enough not to track anyone. */
export const AGE_GATE_COOKIE_MAX_AGE_SEC = 60 * 60;

export type Birth = { birthYear: number; birthMonth: number };

type GateCtx = Pick<Ctx, "db" | "now">;

// ── Gates ───────────────────────────────────────────────────────────────────

/**
 * Whether new accounts can be created right now (decision D2: closed until the launch-readiness
 * checklist passes). When closed, counts the attempt in the anonymous `signup.closed_attempt` counter.
 */
export async function checkSignupOpen(ctx: GateCtx): Promise<boolean> {
  if (await isSignupOpen(ctx)) return true;
  await incrementCounter(ctx, "signup.closed_attempt");
  return false;
}

export async function assertSignupOpen(ctx: GateCtx): Promise<void> {
  if (await checkSignupOpen(ctx)) return;
  throw new AppError("not_ready", "We're not open for new sign-ups just yet. Please check back soon.", {
    detail: { signupClosed: true },
  });
}

export type AgeCheck = { age: number; safetyBand: SafetyBand; pathway: Pathway };

/**
 * The age gate. Under 13: one anonymous count, then `age_blocked`. Nothing else is read or written.
 * A month and year that cannot be right (not a date, or more than 100 years ago) is `invalid_input`.
 */
export async function assertOldEnough(ctx: GateCtx, birth: Birth): Promise<AgeCheck> {
  let age: number;
  try {
    age = ageFromBirth(birth.birthYear, birth.birthMonth, ctx.now);
  } catch {
    throw new AppError("invalid_input", "Choose the month and the year of birth.", {
      fieldErrors: { birth: ["Choose a month and a year."] },
    });
  }
  if (age > 100) {
    throw new AppError("invalid_input", "That year doesn't look right. Check the year of birth and try again.", {
      fieldErrors: { birth: ["Check the year."] },
    });
  }
  const safetyBand = safetyBandForAge(age);
  const pathway = pathwayForAge(age);
  if (age < MINIMUM_AGE || !safetyBand || !pathway) {
    await incrementCounter(ctx, "signup.under13_blocked");
    // Deliberately no detail: not the month, not the year, not the age.
    throw new AppError("age_blocked", "This site is for people aged 13 to 18, so we can't set up an account right now.");
  }
  return { age, safetyBand, pathway };
}

/** Which sign-up a birth month and year leads to. Runs the age gate first. */
export async function signupRouteForBirth(ctx: GateCtx, birth: Birth): Promise<"teen" | "adult"> {
  const { age } = await assertOldEnough(ctx, birth);
  if (age >= ADULT_AGE && (await getSetting(ctx, "site.adult_self_serve"))) return "adult";
  return "teen";
}

// ── Usernames against the database ──────────────────────────────────────────

export async function isUsernameTaken(db: Db, username: string): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.username, username.trim().toLowerCase())).limit(1);
  return rows.length > 0;
}

/** Three made-up usernames that pass the rules and are free right now. */
export async function suggestAvailableUsernames(db: Db, context: UsernameContext = {}, count = 3): Promise<string[]> {
  const candidates = suggestUsernames(count * 3, { context });
  if (candidates.length === 0) return [];
  const taken = await db.select({ username: user.username }).from(user).where(inArray(user.username, candidates));
  const takenSet = new Set(taken.map((row) => row.username?.toLowerCase()));
  return candidates.filter((candidate) => !takenSet.has(candidate)).slice(0, count);
}

function listInWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * The full username check: the rules in `username.ts`, then whether it is free. When the choice
 * is refused the error says why and offers three safe alternatives.
 */
export async function assertUsernameAllowed(db: Db, raw: string, context: UsernameContext = {}): Promise<string> {
  const checked = checkUsername(raw, context);
  let problem: string | null = null;
  if (!checked.ok) problem = checked.message;
  else if (await isUsernameTaken(db, checked.username)) problem = "That username is already taken.";
  if (problem === null && checked.ok) return checked.username;

  const suggestions = await suggestAvailableUsernames(db, context);
  const message = suggestions.length > 0 ? `${problem} You could use ${listInWords(suggestions)}.` : (problem ?? "");
  throw new AppError("invalid_input", message, { fieldErrors: { username: [message] }, detail: { suggestions } });
}

// ── Creating a learner ──────────────────────────────────────────────────────

export type NewLearner = {
  nickname: string;
  /** Already checked with `assertUsernameAllowed`. */
  username: string;
  birth: Birth;
  age: AgeCheck;
  password?: string | null;
  /** Only for an 18-year-old's own account. Under-18s never have an email address. */
  email?: string | null;
  status: UserStatus;
  statusReason?: string | null;
  /** The family to join as a learner, if there is one yet. */
  familyId?: string | null;
  addedBy?: string | null;
};

/**
 * Inserts the user, the profile and (when there is a family) the membership. Runs in the caller's
 * transaction. The caller has already run the gates, the username check and authorisation.
 */
export async function insertLearner(ctx: Pick<Ctx, "now">, tx: Db, input: NewLearner): Promise<UserRow> {
  const created = await createAccount(tx, {
    kind: "learner",
    name: input.nickname,
    username: input.username,
    password: input.password ?? null,
    email: input.email ?? null,
    emailVerified: false,
    status: input.status,
  });
  if (input.statusReason) {
    await tx.update(user).set({ statusReason: input.statusReason }).where(eq(user.id, created.id));
  }
  await tx.insert(learnerProfile).values({
    userId: created.id,
    birthMonth: input.birth.birthMonth,
    birthYear: input.birth.birthYear,
    safetyBand: input.age.safetyBand,
    safetyBandCheckedAt: ctx.now,
    pathway: input.age.pathway,
    nickname: input.nickname,
    // Random, and nothing to do with the learner: it only decides which shapes the avatar draws.
    avatarSeed: newToken(9),
    interests: [],
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  if (input.familyId) {
    await tx.insert(familyMember).values({
      familyId: input.familyId,
      userId: created.id,
      role: "learner",
      addedBy: input.addedBy ?? null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
  }
  return created;
}

// ── Email verification ──────────────────────────────────────────────────────

/** Where an emailed link lands: it finishes sign-in and sends each kind of user to the right place. */
export const AFTER_EMAIL_LINK_PATH = "/signin/continue";

/** Asks Better Auth to email a "confirm your address" link. Returns false if it could not be sent. */
export async function sendVerificationLink(email: string, callbackURL: string = AFTER_EMAIL_LINK_PATH): Promise<boolean> {
  try {
    await getAuth().api.sendVerificationEmail({ body: { email, callbackURL } });
    return true;
  } catch (error) {
    // Do not log the address. Signing in sends a fresh link, so the account is not stuck.
    logWarn("signup.verification_email_failed", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function isEmailConflict(error: unknown): boolean {
  return error instanceof AppError && error.code === "conflict" && !error.fieldErrors?.username;
}

// ── Parent sign-up ──────────────────────────────────────────────────────────

export type ParentSignupInput = {
  email: string;
  /** Leave out to sign in with emailed links only. */
  password?: string | null;
  /** What we call them in emails. Optional. */
  name?: string | null;
  /** The 18+ and parental-responsibility declaration. Must be true. */
  confirmedAdult: boolean;
};

export type ParentSignupResult = {
  /** False when the address already had an account: the caller shows the same "check your email" page either way. */
  created: boolean;
  userId: string | null;
  familyId: string | null;
};

export const DEFAULT_PARENT_NAME = "Parent or carer";

/**
 * Creates a parent account and the family it owns, then emails a link to confirm the address.
 * The account cannot sign in until the address is confirmed.
 *
 * If the address already has an account the result looks the same from outside, so the form
 * cannot be used to find out who has an account.
 */
export async function signUpParent(ctx: Ctx, input: ParentSignupInput): Promise<ParentSignupResult> {
  await assertSignupOpen(ctx);
  if (!input.confirmedAdult) {
    throw new AppError("invalid_input", "Parent accounts are for adults. Please confirm that you are 18 or over and are the parent or carer.", {
      fieldErrors: { confirmedAdult: ["Tick this box to confirm."] },
    });
  }
  const email = normaliseEmail(input.email);
  if (isLearnerPlaceholderEmail(email)) {
    throw new AppError("invalid_input", "That email address can't be used. Please try a different one.", { fieldErrors: { email: ["Try a different address."] } });
  }
  const name = input.name?.trim() || DEFAULT_PARENT_NAME;
  if (input.password) await assertPasswordAllowed(input.password, { name: input.name ?? null, email });

  let created: { userId: string; familyId: string };
  try {
    created = await ctx.db.transaction(async (tx) => {
      const parent = await createAccount(tx, {
        kind: "parent",
        name,
        email,
        password: input.password ?? null,
        emailVerified: false,
        status: "active",
      });
      const families = await tx
        .insert(family)
        .values({ ownerUserId: parent.id, plan: "free", createdAt: ctx.now, updatedAt: ctx.now })
        .returning({ id: family.id });
      const familyId = families[0]?.id;
      if (!familyId) throw new Error("Family insert returned no row");
      await tx.insert(familyMember).values({ familyId, userId: parent.id, role: "parent", createdAt: ctx.now, updatedAt: ctx.now });
      await audit(ctx, { action: "signup.parent", targetType: "user", targetId: parent.id, meta: { familyId, withPassword: Boolean(input.password) } }, tx);
      return { userId: parent.id, familyId };
    });
  } catch (error) {
    if (!isEmailConflict(error)) throw error;
    // Already registered. If they never confirmed the address, send the link again; otherwise stay silent.
    const existing = await ctx.db.select({ emailVerified: user.emailVerified, kind: user.kind }).from(user).where(eq(user.email, email)).limit(1);
    if (existing[0] && !existing[0].emailVerified && existing[0].kind === "parent") await sendVerificationLink(email);
    return { created: false, userId: null, familyId: null };
  }
  await sendVerificationLink(email);
  return { created: true, ...created };
}

// ── An 18-year-old signing up for themselves ────────────────────────────────

export type AdultSignupInput = Birth & {
  username: string;
  email: string;
  password: string;
  /** Their own consent choices, by key. Every required consent must be true. */
  consents: Record<string, boolean>;
};

export type AdultSignupResult = { created: boolean; userId: string | null; familyId: string | null };

/**
 * Spec 3.1: "An 18-year-old can hold their own account and pay themselves." Only when the
 * `site.adult_self_serve` setting is on. The account is a learner with their own email address
 * (which must be confirmed before they can sign in) and a single-seat family that they own, so
 * billing and entitlements work exactly as they do for a parent's family.
 */
export async function signUpAdultLearner(ctx: Ctx, input: AdultSignupInput): Promise<AdultSignupResult> {
  const birth = { birthYear: input.birthYear, birthMonth: input.birthMonth };
  // The age gate comes first, as everywhere: under 13, nothing else is looked at.
  const age = await assertOldEnough(ctx, birth);
  await assertSignupOpen(ctx);
  if (age.age < ADULT_AGE || !(await getSetting(ctx, "site.adult_self_serve"))) {
    throw new AppError("parent_approval_required", "Under-18s need a parent or carer to approve their account. Go back and use the sign-up for teenagers.");
  }
  const email = normaliseEmail(input.email);
  if (isLearnerPlaceholderEmail(email)) {
    throw new AppError("invalid_input", "That email address can't be used. Please try a different one.", { fieldErrors: { email: ["Try a different address."] } });
  }
  const definitions = await listConsentDefinitions(ctx);
  const required = new Set<string>([...REQUIRED_CONSENT_KEYS, ...definitions.filter((d) => d.required).map((d) => d.key)]);
  const notGiven = [...required].filter((key) => input.consents[key] !== true);
  if (notGiven.length > 0) {
    throw new AppError("consent_required", "We need your agreement to the three required permissions to run your account. Tick each one to carry on.", {
      fieldErrors: Object.fromEntries(notGiven.map((key) => [`consent.${key}`, ["Needed to run your account."]])),
    });
  }
  const username = await assertUsernameAllowed(ctx.db, input.username, { birthYear: input.birthYear });
  await assertPasswordAllowed(input.password, { username, email });

  let created: { userId: string; familyId: string };
  try {
    created = await ctx.db.transaction(async (tx) => {
      const learner = await insertLearner(ctx, tx, {
        // No nickname is asked for: the username doubles as the display name until they change it.
        nickname: username,
        username,
        birth,
        age,
        password: input.password,
        email,
        status: "active",
      });
      const families = await tx
        .insert(family)
        .values({ ownerUserId: learner.id, plan: "free", createdAt: ctx.now, updatedAt: ctx.now })
        .returning({ id: family.id });
      const familyId = families[0]?.id;
      if (!familyId) throw new Error("Family insert returned no row");
      await tx.insert(familyMember).values({ familyId, userId: learner.id, role: "learner", createdAt: ctx.now, updatedAt: ctx.now });
      const consent = await applyConsentChoices(ctx, tx, {
        learnerId: learner.id,
        familyId,
        actorUserId: learner.id,
        choices: input.consents,
        method: "signup",
        confirmPause: false,
      });
      if (consent.missingRequired.length > 0) {
        throw new AppError("consent_required", "We couldn't record the required permissions, so the account wasn't created. Please try again.");
      }
      await audit(ctx, { action: "signup.adult_learner", targetType: "user", targetId: learner.id, meta: { familyId } }, tx);
      return { userId: learner.id, familyId };
    });
  } catch (error) {
    if (!isEmailConflict(error)) throw error;
    return { created: false, userId: null, familyId: null };
  }
  await sendVerificationLink(email);
  return { created: true, ...created };
}
