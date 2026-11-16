/**
 * `pnpm db:seed` — fills an empty, migrated database with an explorable LOCAL environment
 * (spec Section 15). Development and tests only: it refuses to run unless `APP_ENV` is `local` or
 * `test`, so it can never touch a preview or production database.
 *
 * It is built from the real services, not raw inserts, wherever a service exists: sign-up, the
 * consent centre, the fake Stripe driver's signed webhooks, the course importer's review and
 * publish path, the player's save and quiz services, submissions and moderation. So what you see
 * after seeding is what the product itself would have produced. Where there is no service yet
 * (staff accounts, tags, prompt templates) the rows are written here, and each such place says so.
 *
 * Safe to run again. Every part looks for what it made last time first. A part whose slice is not
 * built yet prints `skipped: <what>, not built yet` and the seed carries on; run it again later
 * to pick that part up. A part that fails for any other reason is listed under "Problems" at the
 * end and the exit code is 1, but everything else is still seeded.
 *
 * Every account uses the password in `SEED_PASSWORD`. Staff accounts are enrolled in two-step
 * sign-in with one fixed, well-known secret (`SEED_TOTP_SECRET`, printed at the end) so that
 * Studio can be opened locally. That secret is public: it must never protect a real account, which
 * is one more reason this script refuses to run outside local development and tests.
 *
 * Loads `.env.local` unless `DOTENV_PATH` names another file.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { symmetricEncrypt } from "better-auth/crypto";
import { config } from "dotenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { flattenSteps, type FlatStep } from "@/content/course-utils";
import { CATEGORY_LABELS, CATEGORY_SLUGS, INTEREST_TAGS, type Course } from "@/content/schema";
import { env } from "@/env";
import { londonMinutesOfDay, londonYearMonth } from "@/lib/dates";
import { COACH_ROUTE_ALIAS } from "@/server/ai/gateway";
import { FIXTURE_MODEL_ID, FIXTURE_PROVIDER_KEY } from "@/server/ai/fixture-model";
import { createAccount, normaliseEmail, type UserRow } from "@/server/auth/accounts";
import { audit } from "@/server/audit";
import { ANONYMOUS, type Actor, type LearnerActor, type ParentActor, type StaffActor, type StaffRole } from "@/server/authz/actor";
import { loadActor, type Ctx } from "@/server/context";
import {
  certificate,
  closeDb,
  course,
  courseTool,
  courseVersion,
  creditPrice,
  db,
  enrolment,
  family,
  familyMember,
  moderationItem,
  modelRoute,
  parentLinkRequest,
  project,
  promoCode,
  promptTemplate,
  report,
  retentionPolicy,
  safeguardingCase,
  staffRole,
  step,
  subscription,
  tag,
  tool,
  twoFactor,
  user,
} from "@/server/db";
import { AppError } from "@/server/errors";
import { setFlag } from "@/server/flags";
import { installKernelHooks } from "@/server/kernel";
import { approveProcessor, setProcessorEnabled } from "@/server/processors";
import { recordAgeAssurance } from "@/server/services/age-assurance";
import { startCardCheck, startCheckout } from "@/server/services/billing";
import { addChild } from "@/server/services/children";
import { REQUIRED_CONSENT_KEYS, saveConsents } from "@/server/services/consent";
import { createCourse, loadVersionContent } from "@/server/services/course-store";
import { TUTOR_MESSAGE_PRICE_KEY } from "@/server/services/credits";
import { startCourse } from "@/server/services/enrolment";
import { decideModeration } from "@/server/services/moderation";
import { completeOnboarding, saveAvatar, saveInterests, newAvatarChoices } from "@/server/services/onboarding";
import { createPromo } from "@/server/services/promo";
import { guideStepIdsOf, saveStep } from "@/server/services/progress";
import { submitForReview } from "@/server/services/publish";
import { submitQuizAttempt } from "@/server/services/quiz";
import { createReport } from "@/server/services/reports";
import { ensureRetentionPolicies } from "@/server/services/retention";
import { openSafeguardingCase } from "@/server/services/safeguarding";
import { signUpAdultLearner, signUpParent } from "@/server/services/signup";
import { addLinkEvidence, submitWork } from "@/server/services/submission";
import { signUpTeen } from "@/server/services/teen-signup";
import { createCandidateTool } from "@/server/services/tools";
import { getSetting, setSetting } from "@/server/settings";
import { isSignupOpen, markLaunchReadyForDev } from "@/server/settings/launch-readiness";
import { completeFakeCheckout, completeFakeSetup, simulateSubscriptionChange } from "@/server/stripe/fake-simulator";
import { importConsents } from "./import-consents";
import { ensureSeedOwner, formatImportResult, importContent } from "./import-courses";
import { importIdeas, scriptCtx } from "./import-ideas";
import { importPlans } from "./import-plans";
import { formatPlaceholderResult, makePlaceholderAssets } from "./make-placeholder-assets";

export const SEED_REASON = "Development seed";

/**
 * The two-step sign-in secret for every seeded staff account, in base32 (type it into an
 * authenticator app, or use the `otpauth://` link the seed prints). PUBLIC AND LOCAL ONLY.
 */
export const SEED_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** Shown against every staff row of the account table, so the secret is beside the account it opens. */
const STAFF_NOTE = `two-step sign-in, local TOTP secret ${SEED_TOTP_SECRET}`;

const DAY_MS = 24 * 60 * 60 * 1000;

// ───────────────────────────── Who gets seeded ─────────────────────────────

/** One account per staff role. The owner (`OWNER_BOOTSTRAP_EMAIL`) holds `super_admin`. */
const STAFF: ReadonlyArray<{ role: Exclude<StaffRole, "super_admin">; email: string; name: string }> = [
  { role: "admin", email: "admin@example.test", name: "Seed Admin" },
  { role: "editor", email: "editor@example.test", name: "Seed Editor" },
  { role: "reviewer", email: "reviewer@example.test", name: "Seed Reviewer" },
  { role: "safety_reviewer", email: "safety.reviewer@example.test", name: "Seed Safety Reviewer" },
  { role: "moderator", email: "moderator@example.test", name: "Seed Moderator" },
  { role: "dsl", email: "dsl@example.test", name: "Seed Safeguarding Lead" },
  { role: "support", email: "support@example.test", name: "Seed Support" },
];

type SeedChild = { username: string; nickname: string; age: number; interests: string[] };
type SeedFamily = { key: "free" | "family"; email: string; name: string; children: SeedChild[] };

/** Free has two places and Family four (content/plans), so the four teenagers are split two and two. */
const FAMILIES: readonly SeedFamily[] = [
  {
    key: "free",
    email: "parent.free@example.test",
    name: "Frankie (Free plan)",
    children: [
      { username: "pixel_otter", nickname: "Pip", age: 13, interests: ["games", "apps", "art"] },
      { username: "quiet_comet", nickname: "Juno", age: 16, interests: ["study", "writing", "science"] },
    ],
  },
  {
    key: "family",
    email: "parent.family@example.test",
    name: "Morgan (Family plan)",
    children: [
      { username: "neon_badger", nickname: "Rio", age: 15, interests: ["film", "music", "design"] },
      { username: "solar_wren", nickname: "Sky", age: 17, interests: ["coding", "apps", "business"] },
    ],
  },
];

const ADULT_LEARNER = { username: "lunar_moth", email: "adult.learner@example.test", age: 18, interests: ["careers", "business", "film"] };
const PENDING_TEEN = { username: "turbo_finch", age: 14, parentEmail: "pending.parent@example.test" };

const COURSES = {
  promo: "shoot-a-promo-advert-in-an-afternoon",
  snaplab: "build-your-own-snapchat-style-app",
  helper: "homework-helper-chatbot-the-honest-kind",
  promptGym: "prompt-gym-from-vague-to-laser-sharp",
} as const;

const AI_DRAFT_SLUG = "sample-ai-draft-prompt-gym-remix";

/**
 * Spec Section 15: "around 10 further candidate tools marked to verify". Only a name and the
 * vendor's own address are recorded. Being on this list says nothing about whether a tool is
 * suitable for under-18s: that is exactly what has not been checked yet.
 */
const CANDIDATE_TOOLS: ReadonlyArray<{ name: string; vendorDomain: string; officialUrl: string }> = [
  { name: "Teachable Machine", vendorDomain: "teachablemachine.withgoogle.com", officialUrl: "https://teachablemachine.withgoogle.com/" },
  { name: "Google Colab", vendorDomain: "colab.research.google.com", officialUrl: "https://colab.research.google.com/" },
  { name: "Scratch", vendorDomain: "scratch.mit.edu", officialUrl: "https://scratch.mit.edu/" },
  { name: "Figma", vendorDomain: "figma.com", officialUrl: "https://www.figma.com/" },
  { name: "Notion", vendorDomain: "notion.so", officialUrl: "https://www.notion.so/" },
  { name: "Claude", vendorDomain: "claude.ai", officialUrl: "https://claude.ai/" },
  { name: "Gemini", vendorDomain: "gemini.google.com", officialUrl: "https://gemini.google.com/" },
  { name: "Microsoft Copilot", vendorDomain: "copilot.microsoft.com", officialUrl: "https://copilot.microsoft.com/" },
  { name: "BandLab", vendorDomain: "bandlab.com", officialUrl: "https://www.bandlab.com/" },
  { name: "Adobe Express", vendorDomain: "adobe.com", officialUrl: "https://www.adobe.com/express/" },
];

// ───────────────────────────── Result and reporting ─────────────────────────────

export type SeedAccountRow = { who: string; signIn: string; kind: string; notes: string };

export type SeedResult = {
  database: string;
  accounts: SeedAccountRow[];
  /** Parts skipped because their slice is not built yet. */
  skipped: string[];
  /** Parts that failed for another reason. An empty list means a clean run. */
  problems: string[];
  signupOpen: boolean;
  totp: { secret: string; uri: string };
};

export type SeedOptions = {
  log?: (line: string) => void;
  /** Make placeholder media in storage. Default true. */
  assets?: boolean;
  /** The clock. Default: now. */
  now?: Date;
};

/** Refuses anything but local development and tests. Exported so the refusal can be tested on its own. */
export function assertSeedAllowed(appEnv: string = env.APP_ENV, nodeEnv: string = env.NODE_ENV): void {
  if ((appEnv !== "local" && appEnv !== "test") || nodeEnv === "production") {
    throw new AppError(
      "forbidden",
      `db:seed refuses to run when APP_ENV is "${appEnv}"${nodeEnv === "production" ? " and NODE_ENV is production" : ""}. It creates accounts with a shared password and a public two-step secret, and publishes courses without a real review. It is for local development and tests only.`,
    );
  }
}

/** The name a `notImplemented()` contract threw with, or null for any other error. */
export function notBuiltName(error: unknown): string | null {
  if (!(error instanceof AppError)) return null;
  const detail: unknown = error.detail;
  if (typeof detail !== "object" || detail === null || !("notImplemented" in detail)) return null;
  const name = (detail as { notImplemented: unknown }).notImplemented;
  return typeof name === "string" ? name : "unknown";
}

const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
  return `${error.message}${cause}`;
};

// ───────────────────────────── Small helpers ─────────────────────────────

/** A birth month and year that give exactly `age` at `now`, well away from the birthday boundary. */
function birthForAge(age: number, now: Date): { birthYear: number; birthMonth: number } {
  const { year, month } = londonYearMonth(now);
  return month > 6 ? { birthYear: year - age, birthMonth: month - 6 } : { birthYear: year - age - 1, birthMonth: month + 6 };
}

/**
 * A moment in the UK afternoon, at or before `now`. Seeded learning is done at this time so that
 * the default quiet hours (which stop learning at night, exactly as they should) do not stop the
 * seed when it happens to be run late in the evening.
 */
function ukAfternoonAtOrBefore(now: Date): Date {
  let at = now;
  for (let hours = 0; hours < 24; hours += 1) {
    const minutes = londonMinutesOfDay(at);
    if (minutes >= 10 * 60 && minutes <= 17 * 60) return at;
    at = new Date(at.getTime() - 60 * 60 * 1000);
  }
  return now;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.email, normaliseEmail(email))).limit(1);
  return row ?? null;
}

async function findUserByUsername(username: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.username, username.toLowerCase())).limit(1);
  return row ?? null;
}

function seedPassword(): string {
  const password = env.SEED_PASSWORD;
  if (!password) throw new AppError("invalid_input", "Set SEED_PASSWORD in .env.local: every seeded account signs in with it.");
  return password;
}

// ───────────────────────────── The seed ─────────────────────────────

export async function runSeed(options: SeedOptions = {}): Promise<SeedResult> {
  assertSeedAllowed();
  const log = options.log ?? ((line: string) => console.info(line));
  const now = options.now ?? new Date();
  const learningNow = ukAfternoonAtOrBefore(now);
  const password = seedPassword();
  // Auth emails (address confirmation, the teen's request to a parent) go through the kernel hooks.
  installKernelHooks();

  const system = (job: string): Ctx => ({ ...scriptCtx(job), now });
  const anonymous: Ctx = { db, actor: ANONYMOUS, now, requestId: `script:seed:anonymous:${now.getTime()}` };
  const result: SeedResult = {
    database: new URL(env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL).pathname.replace(/^\//, ""),
    accounts: [],
    skipped: [],
    problems: [],
    signupOpen: false,
    totp: { secret: SEED_TOTP_SECRET, uri: `otpauth://totp/${encodeURIComponent("Local seed staff")}?secret=${SEED_TOTP_SECRET}&issuer=${encodeURIComponent(env.NEXT_PUBLIC_BRAND_NAME)}&digits=6&period=30` },
  };

  /**
   * Runs one optional part. A contract that is not built yet is a skip, said plainly; any other
   * failure is recorded and the seed carries on, so one broken slice cannot leave the owner with
   * an empty database.
   */
  async function part<T>(what: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      const notBuilt = notBuiltName(error);
      if (notBuilt !== null) {
        result.skipped.push(`${what} (${notBuilt})`);
        log(`skipped: ${what}, not built yet (${notBuilt})`);
        return null;
      }
      result.problems.push(`${what}: ${describe(error)}`);
      log(`FAILED: ${what}: ${describe(error)}`);
      return null;
    }
  }

  const actorFor = async (userId: string, at: Date = now): Promise<Actor> => loadActor(db, { userId, createdAt: at, twoFactorVerified: true }, at);
  async function parentCtx(userId: string): Promise<Ctx<ParentActor>> {
    const actor = await actorFor(userId);
    if (actor.type !== "parent") throw new Error("Seed: expected a parent account");
    return { db, actor, now, requestId: `script:seed:parent:${userId}` };
  }
  async function learnerCtx(userId: string, at: Date = learningNow): Promise<Ctx<LearnerActor>> {
    const actor = await actorFor(userId, at);
    if (actor.type !== "learner") throw new Error("Seed: expected an active learner account");
    return { db, actor, now: at, requestId: `script:seed:learner:${userId}` };
  }

  // ── 1. Plans and consent wording ──────────────────────────────────────────
  const plans = await importPlans(system("seed.plans"));
  log(`Plans: ${plans.inserted.length} added, ${plans.updated.length} updated.`);
  const consents = await importConsents(system("seed.consents"));
  log(`Consents: ${consents.inserted.length} added, ${consents.unchanged.length} unchanged.`);

  // ── 2. The owner and one account per staff role ───────────────────────────
  const ownerActor = await ensureSeedOwner(system("seed.owner"));
  const owner: Ctx<StaffActor> = { db, actor: ownerActor, now, requestId: "script:seed:owner" };
  const staffIds = new Map<StaffRole, string>([["super_admin", ownerActor.userId]]);
  for (const member of STAFF) {
    // There is no staff-management service yet (Studio's slice): the account comes from
    // `createAccount`, the same function sign-up uses, and the role row is written here.
    let row = await findUserByEmail(member.email);
    if (!row) {
      row = await createAccount(db, { kind: "staff", name: member.name, email: member.email, emailVerified: true, password });
      await audit(owner, { action: "staff.seed.create", targetType: "user", targetId: row.id, reason: SEED_REASON, meta: { role: member.role } });
    }
    await db.insert(staffRole).values({ userId: row.id, role: member.role, grantedBy: ownerActor.userId }).onConflictDoNothing();
    staffIds.set(member.role, row.id);
  }
  // Two-step sign-in. Better Auth reads a secret stored as `base32:<secret>` as an imported
  // authenticator secret, so the code an app shows for SEED_TOTP_SECRET is the code it accepts.
  let enrolled = 0;
  for (const userId of staffIds.values()) {
    const [existing] = await db.select({ id: twoFactor.id }).from(twoFactor).where(eq(twoFactor.userId, userId)).limit(1);
    if (!existing) {
      await db.insert(twoFactor).values({
        userId,
        secret: await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: `base32:${SEED_TOTP_SECRET}` }),
        backupCodes: JSON.stringify([]),
        verified: true,
      });
      enrolled += 1;
    }
    await db.update(user).set({ twoFactorEnabled: true }).where(and(eq(user.id, userId), eq(user.twoFactorEnabled, false)));
  }
  log(`Staff: owner and ${STAFF.length} role accounts ready; ${enrolled} newly enrolled in two-step sign-in.`);
  const staffCtx = async (role: StaffRole): Promise<Ctx<StaffActor>> => {
    const userId = staffIds.get(role);
    const actor = userId ? await actorFor(userId) : ANONYMOUS;
    if (actor.type !== "staff") throw new Error(`Seed: the ${role} account is not usable`);
    return { db, actor, now, requestId: `script:seed:staff:${role}` };
  };

  // ── 3. Ideas, Tool Register, assets and courses (through the real review and publish path) ──
  const ideas = await importIdeas(system("seed.ideas"));
  log(`Course ideas: ${ideas.total} in the file — ${ideas.inserted} added, ${ideas.updated} updated, ${ideas.unchanged} unchanged.`);
  const content = await importContent(system("seed.content"), { publishAsSeed: true });
  log(formatImportResult(content));
  for (const problem of content.problems) result.problems.push(`content import: ${problem}`);

  if (options.assets !== false) {
    await part("placeholder media in storage", async () => log(formatPlaceholderResult(await makePlaceholderAssets())));
  }

  await part("candidate tools to verify", async () => {
    // Names and addresses only. A candidate has no minimum age and no under-18 policy: those are
    // never guessed (spec 3.3), so none of these can be used by a course until a person has checked
    // the vendor's own terms and approved the Register entry.
    let added = 0;
    for (const candidate of CANDIDATE_TOOLS) {
      const made = await createCandidateTool(owner, { ...candidate, notes: "TO VERIFY — development seed. Nothing about this tool has been checked: not its minimum age, its terms for under-18s, its free tier or its privacy settings." });
      if (made.created) added += 1;
    }
    log(`Candidate tools: ${added} added, ${CANDIDATE_TOOLS.length - added} already there. All are "candidate" (to verify): no age, no policy, not usable by any course.`);
  });

  // ── 4. Reference data ─────────────────────────────────────────────────────
  await part("retention policies", async () => {
    const policies = await ensureRetentionPolicies(system("seed.retention"));
    log(`Retention policies: ${policies.inserted.length} added, ${policies.existing.length} already there (left as they were).`);
  });

  // No tag service exists yet: the 24 categories and 16 interest tags come from the content schema.
  const tagRows = [
    ...CATEGORY_SLUGS.map((slug, position) => ({ kind: "category" as const, slug, name: CATEGORY_LABELS[slug], position })),
    ...INTEREST_TAGS.map((slug, position) => ({ kind: "interest" as const, slug, name: slug.charAt(0).toUpperCase() + slug.slice(1), position })),
  ];
  const tagsAdded = await db.insert(tag).values(tagRows).onConflictDoNothing().returning({ id: tag.id });
  log(`Tags: ${tagsAdded.length} added (${CATEGORY_SLUGS.length} categories and ${INTEREST_TAGS.length} interests in all).`);

  await part("Coach price and model route", async () => {
    await db.insert(creditPrice).values({ key: TUTOR_MESSAGE_PRICE_KEY, credits: 1, description: "One Coach message. Placeholder until real costs are measured (spec question 10)." }).onConflictDoNothing();
    // The fixture model is the local stand-in for a provider: it sends nothing anywhere.
    await approveProcessor(owner, { providerKey: FIXTURE_PROVIDER_KEY, name: "Local fixture model", purpose: "Coach replies and course drafts in local development. Sends nothing to any third party.", region: "This machine", dpaReference: "Not applicable: local fixture", notes: SEED_REASON });
    await setProcessorEnabled(owner, FIXTURE_PROVIDER_KEY, true);
    for (const alias of [COACH_ROUTE_ALIAS, "course.draft"]) {
      await db.insert(modelRoute).values({ alias, priority: 0, providerKey: FIXTURE_PROVIDER_KEY, model: FIXTURE_MODEL_ID, enabled: true, params: {}, inputPencePerMillionTokens: 0, outputPencePerMillionTokens: 0 }).onConflictDoNothing();
    }
    log(`Coach: 1 credit a message, model routes "${COACH_ROUTE_ALIAS}" and "course.draft" → local fixture model.`);
  });

  await part("prompt templates", async () => {
    // The prompts Coach really uses are the files in content/prompts. The table is what Studio will edit.
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = resolve(process.cwd(), "content", "prompts");
    let added = 0;
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".md")).sort()) {
      const text = readFileSync(resolve(dir, name), "utf8");
      const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);
      const field = (key: string): string | null => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(front?.[1] ?? "")?.[1]?.trim() ?? null;
      const key = field("key") ?? name.replace(/\.v\d+\.md$/, "");
      const version = Number(field("version") ?? /\.v(\d+)\.md$/.exec(name)?.[1] ?? 1);
      const inserted = await db
        .insert(promptTemplate)
        .values({ key, version, title: field("title") ?? key, body: front ? text.slice(front[0].length) : text, active: true, notes: field("notes"), createdBy: ownerActor.userId })
        .onConflictDoNothing()
        .returning({ id: promptTemplate.id });
      added += inserted.length;
    }
    log(`Prompt templates: ${added} added from content/prompts.`);
  });
  log("Email templates: the defaults are in code (src/server/email/templates.ts); nothing to seed until Studio stores edits.");

  await part("sample feature flag", async () => {
    await setFlag(owner, { key: "dev.sample_flag", enabled: false, description: "Development sample. Nothing reads this flag: it is here so that the flags screen has a row to try." });
  });

  // ── 5. Launch readiness (placeholders) and sign-up open ───────────────────
  const readiness = await markLaunchReadyForDev(system("seed.launch_readiness"));
  if (readiness.ready) {
    if (!(await getSetting(system("seed.signup"), "site.signup_open"))) await setSetting(owner, "site.signup_open", true, "Development seed: sign-up opened with placeholder readiness");
  } else {
    result.problems.push(`launch readiness: still open — ${readiness.outstanding.map((item) => `${item.key} (${item.detail})`).join("; ")}`);
  }
  result.signupOpen = await isSignupOpen(system("seed.signup"));
  log(`Sign-up is ${result.signupOpen ? "open" : "STILL CLOSED"} (placeholder readiness: legal drafts and the safeguarding lead are NOT real sign-offs).`);

  // ── 6. Families ───────────────────────────────────────────────────────────
  const learnerIds = new Map<string, string>();
  const familyIds = new Map<SeedFamily["key"], { familyId: string; parentId: string }>();
  for (const seedFamily of FAMILIES) {
    await part(`the ${seedFamily.key} family`, async () => {
      let parent = await findUserByEmail(seedFamily.email);
      if (!parent) {
        const created = await signUpParent(anonymous, { email: seedFamily.email, password, name: seedFamily.name, confirmedAdult: true });
        if (!created.userId) throw new Error("signUpParent did not create the account");
        // The real flow confirms the address from an emailed link. Nobody can click it here, and
        // there is no service to confirm an address any other way, so the seed sets the flag.
        await db.update(user).set({ emailVerified: true }).where(eq(user.id, created.userId));
        parent = await findUserByEmail(seedFamily.email);
      }
      if (!parent) throw new Error("the parent account could not be read back");
      const ctx = await parentCtx(parent.id);
      familyIds.set(seedFamily.key, { familyId: ctx.actor.familyId, parentId: parent.id });
      // A verified parent email is the age-assurance step for 16–17 (spec 3.1).
      await recordAgeAssurance(ctx, ctx.actor.familyId, "parent_email");

      for (const child of seedFamily.children) {
        let learner = await findUserByUsername(child.username);
        if (!learner) {
          const added = await addChild(ctx, { nickname: child.nickname, username: child.username, password, ...birthForAge(child.age, now) });
          // The account is held until the parent completes the consent centre: do that, as the parent.
          const choices: Record<string, boolean> = Object.fromEntries(REQUIRED_CONSENT_KEYS.map((key) => [key, true]));
          // One learner in each family has chat history switched on, so both retention periods can be seen.
          if (child.age >= 15) choices.tutor_history_retention = true;
          await saveConsents(ctx, added.learnerId, { choices, method: "consent_centre" });
          learner = await findUserByUsername(child.username);
        }
        if (learner) learnerIds.set(child.username, learner.id);
      }
      result.accounts.push({ who: seedFamily.name, signIn: seedFamily.email, kind: "parent", notes: `${seedFamily.key === "free" ? "Free plan" : "Family plan (fake Stripe)"}; children: ${seedFamily.children.map((c) => `${c.username} (${c.age})`).join(", ")}` });
      for (const child of seedFamily.children) result.accounts.push({ who: child.nickname, signIn: child.username, kind: `learner, ${child.age}`, notes: `in ${seedFamily.name}'s family` });
    });
  }

  // ── 7. Billing through the fake Stripe driver: signed webhooks, the real handler ──
  await part("the Family plan (fake Stripe checkout)", async () => {
    const paying = familyIds.get("family");
    if (!paying) throw new Error("the Family-plan family was not created");
    const [existing] = await db.select({ id: subscription.id }).from(subscription).where(eq(subscription.familyId, paying.familyId)).limit(1);
    if (existing) return;
    // Ten days ago the parent started the 7-day trial with a card; three days ago the first payment went through.
    const started = new Date(now.getTime() - 10 * DAY_MS);
    const ctx = { ...(await parentCtx(paying.parentId)), now: started };
    const { url } = await startCheckout(ctx, { planKey: "family", interval: "month" });
    const sessionId = new URL(url, "http://localhost").searchParams.get("session");
    if (!sessionId) throw new Error("the fake checkout gave no session");
    await completeFakeCheckout(sessionId, started);
    const [sub] = await db.select({ stripeId: subscription.stripeSubscriptionId, status: subscription.status }).from(subscription).where(eq(subscription.familyId, paying.familyId)).limit(1);
    if (!sub?.stripeId) throw new Error("the webhook handler did not record a subscription");
    if (sub.status === "trialing") await simulateSubscriptionChange(sub.stripeId, { kind: "period_end" }, new Date(now.getTime() - 3 * DAY_MS));
    const [after] = await db.select({ status: subscription.status, plan: family.plan }).from(subscription).innerJoin(family, eq(family.id, subscription.familyId)).where(eq(subscription.familyId, paying.familyId)).limit(1);
    log(`Billing: ${FAMILIES[1]?.email} is on "${after?.plan}" (subscription ${after?.status}) through fake Stripe webhooks.`);
  });
  await part("the Free family's card check (fake Stripe)", async () => {
    const free = familyIds.get("free");
    if (!free) throw new Error("the Free family was not created");
    const [row] = await db.select({ level: family.ageAssuranceLevel }).from(family).where(eq(family.id, free.familyId)).limit(1);
    if (row?.level === "card_authorisation" || row?.level === "paid_subscription") return;
    // A £0 card check, so the 13-year-old on Free can use Coach (spec 3.1). No money, no plan.
    const { url } = await startCardCheck(await parentCtx(free.parentId));
    const sessionId = new URL(url, "http://localhost").searchParams.get("session");
    if (!sessionId) throw new Error("the fake card check gave no session");
    await completeFakeSetup(sessionId, now);
    log(`Billing: ${FAMILIES[0]?.email} passed the £0 card check (age assurance for the 13-year-old) and stays on Free.`);
  });

  // ── 8. An 18-year-old with their own account, and a teen waiting for a parent ──
  await part("the 18-year-old's own account", async () => {
    let adult = await findUserByUsername(ADULT_LEARNER.username);
    if (!adult) {
      const consentsGiven: Record<string, boolean> = Object.fromEntries(REQUIRED_CONSENT_KEYS.map((key) => [key, true]));
      const created = await signUpAdultLearner(anonymous, { ...birthForAge(ADULT_LEARNER.age, now), username: ADULT_LEARNER.username, email: ADULT_LEARNER.email, password, consents: consentsGiven });
      if (!created.userId) throw new Error("signUpAdultLearner did not create the account");
      await db.update(user).set({ emailVerified: true }).where(eq(user.id, created.userId)); // as for parents: nobody can click the emailed link
      adult = await findUserByUsername(ADULT_LEARNER.username);
    }
    if (adult) learnerIds.set(ADULT_LEARNER.username, adult.id);
    result.accounts.push({ who: "Adult learner", signIn: `${ADULT_LEARNER.username} (or ${ADULT_LEARNER.email})`, kind: "learner, 18", notes: "own account and own single-seat family, Free plan" });
  });
  await part("the pending teen", async () => {
    const existing = await findUserByUsername(PENDING_TEEN.username);
    if (!existing) await signUpTeen(anonymous, { ...birthForAge(PENDING_TEEN.age, now), username: PENDING_TEEN.username, password, parentEmail: PENDING_TEEN.parentEmail });
    const [request] = await db
      .select({ expiresAt: parentLinkRequest.expiresAt })
      .from(parentLinkRequest)
      .innerJoin(user, eq(user.id, parentLinkRequest.learnerId))
      .where(eq(user.username, PENDING_TEEN.username))
      .limit(1);
    result.accounts.push({ who: "Pending teen", signIn: PENDING_TEEN.username, kind: `learner, ${PENDING_TEEN.age}`, notes: `waiting for ${PENDING_TEEN.parentEmail} to approve${request ? "; the approval link is in the email printed above when first seeded" : ""}; deleted after 7 days` });
  });

  // ── 9. Onboarding ─────────────────────────────────────────────────────────
  const everyLearner = [...FAMILIES.flatMap((f) => f.children), { ...ADULT_LEARNER, nickname: ADULT_LEARNER.username }];
  await part("learner onboarding", async () => {
    for (const learner of everyLearner) {
      const userId = learnerIds.get(learner.username);
      if (!userId) continue;
      const ctx = await learnerCtx(userId);
      await saveInterests(ctx, learner.interests);
      const [seedChoice] = newAvatarChoices(1);
      if (seedChoice) await saveAvatar(ctx, seedChoice);
      await completeOnboarding(ctx, {});
    }
  });

  // ── 10. Learning: progress, quizzes, submissions, a certificate ───────────

  /** Works through a course as the learner, using the same services as the player. */
  async function learn(username: string, courseSlug: string, plan: { steps: number | "all"; submit?: { sampled: boolean; note: string } }): Promise<{ enrolmentId: string; created: boolean } | null> {
    const userId = learnerIds.get(username);
    if (!userId) throw new Error(`the learner ${username} was not created`);
    const ctx = await learnerCtx(userId);
    const started = await startCourse(ctx, { learnerId: userId, courseSlug });
    const enrolmentId = started.enrolment.id;
    // Already started on an earlier run: leave the learner's work exactly as it is.
    if (!started.created) return { enrolmentId, created: false };

    const [pinned] = await db.select({ versionId: enrolment.courseVersionId, courseId: enrolment.courseId }).from(enrolment).where(eq(enrolment.id, enrolmentId)).limit(1);
    if (!pinned) throw new Error("the enrolment could not be read back");
    const courseContent: Course = await loadVersionContent(ctx, pinned.versionId);
    const flat = flattenSteps(courseContent);
    const wanted = plan.steps === "all" ? flat : flat.slice(0, plan.steps);
    for (const entry of wanted) {
      if (entry.step.type === "submit") continue;
      await doStep(ctx, enrolmentId, courseContent, entry);
    }
    if (plan.submit) {
      const submitStep = flat.find((entry) => entry.step.type === "submit");
      if (!submitStep) throw new Error(`"${courseSlug}" has no submit step`);
      const [stepRow] = await db.select({ id: step.id }).from(step).where(and(eq(step.courseVersionId, pinned.versionId), eq(step.key, submitStep.step.id))).limit(1);
      if (!stepRow) throw new Error("the submit step has not been materialised");
      // A link under one of the course's own Register tools: the only kind accepted without a person.
      const tools = await db.select({ prefixes: tool.allowedUrlPrefixes }).from(courseTool).innerJoin(tool, eq(tool.id, courseTool.toolId)).where(eq(courseTool.courseVersionId, pinned.versionId)).orderBy(courseTool.position);
      const prefix = tools.flatMap((row) => row.prefixes)[0];
      if (!prefix) throw new Error(`"${courseSlug}" has no tool with an allowed link`);
      // Never fetched by us (spec 3.4), and the address is made up: the DNS answer is supplied so the seed needs no network.
      const deps = { resolver: async () => ["93.184.216.34"], roll: () => (plan.submit?.sampled ? 0 : 0.999999) };
      await addLinkEvidence(ctx, { enrolmentId, stepId: stepRow.id, url: `${prefix}seed-demo/${username.replace(/_/g, "-")}`, declaredNoPeople: true }, deps);
      const selfCheck: Record<string, string> = Object.fromEntries(courseContent.rubric.criteria.map((criterion, index) => [criterion.id, index === 0 ? "Getting there" : "Nailed it"]));
      const sent = await submitWork(ctx, { enrolmentId, stepId: stepRow.id, title: `${courseContent.title} (seed demo)`, note: plan.submit.note, selfCheck }, deps);
      log(`  ${username}: handed in "${courseContent.title}" → ${sent.status}${sent.certificateId ? ", certificate issued" : ""}.`);
    }
    return { enrolmentId, created: true };
  }

  async function doStep(ctx: Ctx<LearnerActor>, enrolmentId: string, courseContent: Course, entry: FlatStep): Promise<void> {
    const current = entry.step;
    if (current.type === "quiz") {
      const quizId = (current.config as { quizId?: unknown } | undefined)?.quizId;
      const quiz = courseContent.quizzes.find((candidate) => candidate.id === quizId) ?? courseContent.quizzes.find((candidate) => candidate.id === current.id);
      if (!quiz) throw new Error(`the quiz for step ${current.id} could not be found`);
      // `order` questions: authored order is the answer (D12). Everything else: the options marked correct.
      const answers = Object.fromEntries(quiz.questions.map((question) => [question.id, question.kind === "order" ? question.options.map((o) => o.id) : question.kind === "multi" ? question.options.filter((o) => o.correct).map((o) => o.id) : question.options.filter((o) => o.correct).map((o) => o.id).slice(0, 1)]));
      const attempt = await submitQuizAttempt(ctx, { enrolmentId, stepKey: current.id, answers });
      if (!attempt.passed) throw new Error(`the seed's quiz answers did not pass step ${current.id}`);
      return;
    }
    const rule = current.completion.rule;
    if (rule === "upload_approved" || rule === "evidence_submitted" || rule === "submit") return; // only the submissions service can finish these
    const written = current.type === "reflection" || current.type === "ethics_checkpoint";
    const saved = await saveStep(ctx, {
      enrolmentId,
      stepKey: current.id,
      intent: "complete",
      data: { watchedFraction: 1, transcriptRead: current.type === "video", ticked: true, guideTicks: guideStepIdsOf(entry) },
      ...(written ? { response: "Seed demo answer: I checked my project shows no real people, and I said clearly where AI helped." } : {}),
    });
    if (saved.status !== "completed") throw new Error(`step ${current.id} did not complete${saved.completion && !saved.completion.complete ? `: ${saved.completion.message}` : saved.stopped ? `: ${saved.stopped.message}` : ""}`);
  }

  await part("progress: Pip (13) part-way through a free course", () => learn("pixel_otter", COURSES.helper, { steps: 9 }));
  await part("progress: Juno (16) just started a free course", () => learn("quiet_comet", COURSES.promptGym, { steps: 4 }));
  await part("an accepted submission and a certificate: Rio (15)", () => learn("neon_badger", COURSES.promo, { steps: "all", submit: { sampled: false, note: "Seed demo: a 30-second advert for a made-up snack. Objects and title cards only." } }));
  await part("progress: Rio (15) part-way through a Family-plan course", () => learn("neon_badger", COURSES.snaplab, { steps: 6 }));
  await part("a pending submission in the review sample: Sky (17)", () => learn("solar_wren", COURSES.snaplab, { steps: "all", submit: { sampled: true, note: "Seed demo: my filter on the sample image, and the chat screen." } }));

  await part("a submission accepted by a moderator: the 18-year-old", async () => {
    const done = await learn(ADULT_LEARNER.username, COURSES.promo, { steps: "all", submit: { sampled: true, note: "Seed demo: an advert for a made-up bike repair stall." } });
    if (!done?.created) return;
    const [held] = await db
      .select({ itemId: moderationItem.id })
      .from(moderationItem)
      .innerJoin(project, eq(project.currentVersionId, moderationItem.subjectId))
      .where(and(eq(project.enrolmentId, done.enrolmentId), eq(moderationItem.state, "pending")))
      .limit(1);
    if (!held) throw new Error("the sampled submission did not reach the moderation queue");
    await decideModeration(await staffCtx("moderator"), held.itemId, { verdict: "approve", note: "Seed demo: checked by a person, nothing to change." });
  });

  await part("a report from a learner (an open moderation item)", async () => {
    const userId = learnerIds.get("quiet_comet");
    if (!userId) throw new Error("the learner quiet_comet was not created");
    const [already] = await db.select({ id: report.id }).from(report).where(eq(report.reporterId, userId)).limit(1);
    if (already) return;
    const [target] = await db.select({ id: course.id }).from(course).where(eq(course.slug, COURSES.promptGym)).limit(1);
    if (!target) throw new Error("the course for the report was not found");
    await createReport(await learnerCtx(userId), { reason: "wrong_or_broken", target: { type: "course", id: target.id, courseId: target.id }, note: "Seed demo report: the link in step 3 goes to the wrong page." });
  });

  // ── 11. A TEST safeguarding case ──────────────────────────────────────────
  await part("the TEST safeguarding case", async () => {
    const [existing] = await db.select({ id: safeguardingCase.id }).from(safeguardingCase).limit(1);
    if (existing) return;
    await openSafeguardingCase(await staffCtx("dsl"), {
      learnerId: learnerIds.get("pixel_otter") ?? null,
      severity: "low",
      trigger: "other",
      summary: "TEST CASE — development seed. Not a real concern about a real child.",
      sourceType: "seed",
      detail: "TEST CASE. This case was created by `pnpm db:seed` so that the safeguarding screens can be tried locally. Nothing happened and nobody is at risk.",
      isTest: true,
    });
  });

  // ── 12. One AI-drafted course waiting in the review queue ─────────────────
  await part("the sample AI draft in the review queue", async () => {
    result.skipped.push("a preview link for the sample AI draft (preview.resolvePreview)");
    log("skipped: a preview link for the sample AI draft, not built yet (preview.resolvePreview)");
    const [existing] = await db.select({ id: course.id }).from(course).where(eq(course.slug, AI_DRAFT_SLUG)).limit(1);
    if (existing) return;
    const [source] = await db.select({ snapshot: courseVersion.snapshot }).from(course).innerJoin(courseVersion, eq(courseVersion.id, course.publishedVersionId)).where(eq(course.slug, COURSES.promptGym)).limit(1);
    if (!source) throw new Error("the course to base the sample draft on is not published");
    const base = source.snapshot as Course;
    const draft: Course = {
      ...base,
      slug: AI_DRAFT_SLUG,
      title: "SAMPLE AI DRAFT: Prompt Gym Remix",
      editorNotes: "SAMPLE for local development. This is a copy of Prompt Gym labelled as an AI draft so the approve / edit / request-edits / decline path can be tried. It was not written by a model and must never be published.",
      verifyFlags: [{ path: "toolRequirements.0", claim: "[VERIFY] The tool's free tier still allows the number of messages this course needs for a 13-year-old with parental consent.", evidenceUrl: "https://example.com/seed-evidence/free-tier" }],
    };
    delete draft.id;
    delete draft.ideaId;
    const created = await createCourse(owner, draft, {
      origin: "ai_on_demand",
      note: "Sample AI draft (development seed)",
      generationMeta: { model: FIXTURE_MODEL_ID, promptVersion: "seed", costPence: 0, retries: 0, sample: true, evidence: [{ url: "https://example.com/seed-evidence/free-tier", note: "Placeholder evidence link for the [VERIFY] flag." }] },
    });
    await submitForReview(owner, created.course.id);
    log(`AI draft: "${draft.title}" is waiting in the review queue.`);
  });

  // ── 13. Promo samples ─────────────────────────────────────────────────────
  await part("promo code samples", async () => {
    const samples = [
      { code: "SEED10", kind: "percent_off" as const, percentOff: 10, note: "Development sample: 10% off the first payment." },
      { code: "SEEDTRIAL30", kind: "free_period" as const, freeDays: 30, note: "Development sample: a 30-day free period." },
      { code: "SEEDENERGY", kind: "credit_grant" as const, creditGrant: 50, note: "Development sample: 50 extra Coach credits for each learner." },
    ];
    const existing = await db.select({ code: promoCode.code }).from(promoCode).where(inArray(promoCode.code, samples.map((sample) => sample.code)));
    const have = new Set(existing.map((row) => row.code.toUpperCase()));
    for (const sample of samples) if (!have.has(sample.code)) await createPromo(owner, sample);
  });

  for (const what of ["Radar source records (the Radar engine)", "marketing and help pages (the marketing slice owns content/help)", "drafting prompt templates (the course creation engine)"]) {
    result.skipped.push(what);
    log(`skipped: ${what}, not built yet`);
  }

  // ── 14. What was made ─────────────────────────────────────────────────────
  result.accounts.unshift(
    { who: "Owner", signIn: env.OWNER_BOOTSTRAP_EMAIL ?? "(OWNER_BOOTSTRAP_EMAIL)", kind: "staff: super_admin", notes: STAFF_NOTE },
    ...STAFF.map((member) => ({ who: member.name, signIn: member.email, kind: `staff: ${member.role}`, notes: STAFF_NOTE })),
  );
  const [counts] = await db
    .select({
      courses: sql<number>`(select count(*)::int from ${course} where ${course.status} = 'published')`,
      enrolments: sql<number>`(select count(*)::int from ${enrolment})`,
      certificates: sql<number>`(select count(*)::int from ${certificate})`,
      queue: sql<number>`(select count(*)::int from ${moderationItem} where ${moderationItem.state} = 'pending')`,
      members: sql<number>`(select count(*)::int from ${familyMember})`,
      policies: sql<number>`(select count(*)::int from ${retentionPolicy})`,
    })
    .from(sql`(select 1) as one`);
  log(`Totals: ${counts?.courses ?? 0} published courses, ${counts?.enrolments ?? 0} enrolments, ${counts?.certificates ?? 0} certificates, ${counts?.queue ?? 0} open moderation items, ${counts?.members ?? 0} family members, ${counts?.policies ?? 0} retention policies.`);
  return result;
}

export function formatSeedResult(result: SeedResult): string {
  const headers = ["Who", "Sign in with", "Kind", "Notes"];
  const rows = result.accounts.map((row) => [row.who, row.signIn, row.kind, row.notes]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const line = (cells: string[]): string => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  const lines = [
    "",
    `Seeded "${result.database}". Sign-up is ${result.signupOpen ? "open" : "CLOSED"}.`,
    "",
    line(headers),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line),
    "",
    "Password for every account: the value of SEED_PASSWORD in your env file (.env.local).",
    "Parents and staff sign in with their email address; learners with their username.",
    `Staff two-step sign-in (LOCAL ONLY, public secret): ${result.totp.secret}`,
    `  Add it to an authenticator app by hand, or open: ${result.totp.uri}`,
  ];
  if (result.skipped.length > 0) lines.push("", "Skipped because that part of the product is not built yet (run db:seed again later):", ...result.skipped.map((item) => `  - ${item}`));
  if (result.problems.length > 0) lines.push("", "Problems:", ...result.problems.map((item) => `  - ${item}`));
  return lines.join("\n");
}

async function main(): Promise<void> {
  // DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
  config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
  try {
    const result = await runSeed();
    console.info(formatSeedResult(result));
    process.exitCode = result.problems.length > 0 ? 1 : 0;
  } finally {
    await closeDb();
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error("Seed failed:", describe(error));
    process.exit(1);
  });
}
