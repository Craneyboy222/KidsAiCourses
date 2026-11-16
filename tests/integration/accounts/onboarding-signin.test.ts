import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { LOCKOUT_MAX_FAILURES } from "@/server/auth/lockout";
import type { LearnerActor, ParentActor } from "@/server/authz/actor";
import { learnerProfile, user } from "@/server/db/schema";
import type { CatalogueCourse } from "@/server/services/catalogue";
import { saveConsents } from "@/server/services/consent";
import { completeOnboarding, getFirstProjectChoices, getLearnerOnboarding, getParentOnboarding, saveAccessibility, saveAvatar, saveInterests } from "@/server/services/onboarding";
import { LOCKOUT_MESSAGE, ctxForUser, passwordFailure, resolveAfterSignIn, savedA11yPrefs, signInFailure, signedInFacts, twoFactorFailure } from "@/server/services/sign-in";
import { closeDb, db, testCtx } from "../../helpers/db";
import { TEST_PASSWORD, createLearner, createParent, createStaff } from "../../helpers/factories";
import { NOW, REQUIRED_TICKED, expectNoPlaceholderEmail, freshAccountsDb, mockedEntitlement } from "./helpers";

// MOCKED: the catalogue belongs to the learning slice and its bodies still throw.
const catalogue = vi.hoisted(() => ({ recommended: [] as unknown[], free: [] as unknown[], fail: false }));
vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));
vi.mock("@/server/services/catalogue", () => ({
  recommendForLearner: vi.fn(async () => {
    if (catalogue.fail) throw new Error("catalogue is down");
    return catalogue.recommended;
  }),
  listCatalogue: vi.fn(async () => ({ items: catalogue.free, total: catalogue.free.length })),
}));

const course = (slug: string, over: Partial<CatalogueCourse> = {}): CatalogueCourse => ({
  id: `id-${slug}`,
  slug,
  title: `Course ${slug}`,
  tagline: "A tagline",
  whatYouMake: "A thing you make.",
  category: "apps",
  difficulty: "starter",
  pathways: ["ks3"],
  minAge: 13,
  isFree: true,
  estimatedMinutes: 45,
  interests: ["apps"],
  toolSlugs: [],
  lastVerifiedAt: null,
  publishedAt: null,
  locked: false,
  saved: false,
  enrolled: false,
  ...over,
});

beforeEach(async () => {
  await freshAccountsDb();
  catalogue.recommended = [];
  catalogue.free = [];
  catalogue.fail = false;
});
afterAll(async () => {
  await closeDb();
});

async function newLearner(over: Parameters<typeof createLearner>[0] = {}) {
  const { family } = await createParent();
  const created = await createLearner({ familyId: family.id, interests: [], now: NOW, ...over });
  return { ...created, ctx: testCtx(created.actor, { now: NOW }) };
}

describe("learner onboarding", () => {
  it("starts with nothing chosen and cannot be skipped until three interests are saved", async () => {
    const { ctx, user: learner } = await newLearner({ nickname: "Maya" });
    const state = await getLearnerOnboarding(ctx);
    expect(state).toMatchObject({ learnerId: learner.id, nickname: "Maya", interests: [], completed: false, canSkip: false });
    expect(state.a11y).toEqual({ theme: "light", reading: "default", text: "100", motion: "auto" });
    expectNoPlaceholderEmail(state);
    await expect(completeOnboarding(ctx)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("needs at least three of the 16 interest tags, and ignores anything that is not a tag", async () => {
    const { ctx, user: learner } = await newLearner();
    await expect(saveInterests(ctx, ["music", "games"])).rejects.toMatchObject({ code: "invalid_input", fieldErrors: { interests: expect.any(Array) } });
    await expect(saveInterests(ctx, ["music", "music", "MUSIC", "made-up", "games"])).rejects.toMatchObject({ code: "invalid_input" });
    expect(await saveInterests(ctx, ["music", "games", "coding", "<script>", "games"])).toEqual(["music", "games", "coding"]);
    expect((await db.select().from(learnerProfile).where(eq(learnerProfile.userId, learner.id)))[0]?.interests).toEqual(["music", "games", "coding"]);
    expect((await getLearnerOnboarding(ctx)).canSkip).toBe(true);
  });

  it("is skippable after interests: finishing straight away goes home", async () => {
    const { ctx, user: learner } = await newLearner();
    await saveInterests(ctx, ["music", "games", "coding"]);
    expect(await completeOnboarding(ctx)).toEqual({ next: "/home" });
    expect((await db.select().from(learnerProfile).where(eq(learnerProfile.userId, learner.id)))[0]?.onboardingCompletedAt).toEqual(NOW);
    expect((await getLearnerOnboarding(ctx)).completed).toBe(true);
  });

  it("stores only a seed for the avatar: never an image, a link or a name", async () => {
    const { ctx, user: learner } = await newLearner();
    expect(await saveAvatar(ctx, "Ab3_-xYz90Qw")).toBe("Ab3_-xYz90Qw");
    for (const bad of ["https://example.com/me.jpg", "data:image/png;base64,AAAA", "maya", "", "x".repeat(13), "../../etc/pw"]) {
      await expect(saveAvatar(ctx, bad), bad).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect((await db.select().from(learnerProfile).where(eq(learnerProfile.userId, learner.id)))[0]?.avatarSeed).toBe("Ab3_-xYz90Qw");
  });

  it("saves accessibility preferences, falling back to the default for anything unexpected", async () => {
    const { ctx, user: learner } = await newLearner();
    expect(await saveAccessibility(ctx, { theme: "dark", reading: "dyslexia", text: "150", motion: "reduce" })).toEqual({ theme: "dark", reading: "dyslexia", text: "150", motion: "reduce" });
    expect(await saveAccessibility(ctx, { theme: "neon", text: 125, extra: "<b>" })).toEqual({ theme: "light", reading: "default", text: "125", motion: "auto" });
    expect((await db.select().from(learnerProfile).where(eq(learnerProfile.userId, learner.id)))[0]?.a11y).toEqual({ theme: "light", reading: "default", text: "125", motion: "auto" });
  });

  it("offers up to three unlocked first projects from the recommendations, and never a locked one", async () => {
    const { ctx } = await newLearner();
    catalogue.recommended = [course("one"), course("locked-pro", { locked: true, isFree: false }), course("two"), course("three"), course("four")];
    const choices = await getFirstProjectChoices(ctx);
    expect(choices.map((c) => c.slug)).toEqual(["one", "two", "three"]);
    // Nothing a price or a plan could hide in.
    expect(Object.keys(choices[0] ?? {}).sort()).toEqual(["category", "difficulty", "estimatedMinutes", "slug", "tagline", "title", "whatYouMake"]);
  });

  it("falls back to free courses when nothing recommended is open, and to an empty, skippable step if the catalogue is down", async () => {
    const { ctx } = await newLearner();
    catalogue.recommended = [course("locked-pro", { locked: true })];
    catalogue.free = [course("free-one"), course("free-two")];
    expect((await getFirstProjectChoices(ctx)).map((c) => c.slug)).toEqual(["free-one", "free-two"]);
    catalogue.fail = true;
    expect(await getFirstProjectChoices(ctx)).toEqual([]);
  });

  it("finishing with a first project goes to that course; a made-up address goes home", async () => {
    const { ctx } = await newLearner({ interests: ["music", "games", "apps"] });
    expect(await completeOnboarding(ctx, { firstProjectSlug: "build-your-own-app" })).toEqual({ next: "/explore/build-your-own-app" });
    expect(await completeOnboarding(ctx, { firstProjectSlug: "//evil.example/x" })).toEqual({ next: "/home" });
    expect(await completeOnboarding(ctx, { firstProjectSlug: "../parent" })).toEqual({ next: "/home" });
  });

  it("is refused for a paused or pending learner, and for anyone who is not a learner", async () => {
    const { actor } = await newLearner({ status: "paused" });
    await expect(saveInterests(testCtx(actor, { now: NOW }), ["music", "games", "apps"])).rejects.toMatchObject({ code: "paused" });
    const parent = await createParent();
    await expect(getLearnerOnboarding(testCtx(parent.actor, { now: NOW }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveInterests(testCtx(undefined, { now: NOW }), ["music", "games", "apps"])).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("parent onboarding", () => {
  it("tracks the steps: no child, then a child waiting for consent, then complete", async () => {
    const { actor, family } = await createParent();
    const ctx = testCtx<ParentActor>(actor, { now: NOW });
    expect(await getParentOnboarding(ctx)).toEqual({ familyId: family.id, plan: "free", children: [], hasChildren: false, complete: false });

    const { user: child } = await createLearner({ familyId: family.id, nickname: "Maya", now: NOW });
    const waiting = await getParentOnboarding(ctx);
    expect(waiting).toMatchObject({ hasChildren: true, complete: false, children: [{ learnerId: child.id, nickname: "Maya", consentComplete: false }] });
    expectNoPlaceholderEmail(waiting);

    await saveConsents(ctx, child.id, { choices: REQUIRED_TICKED });
    expect(await getParentOnboarding(ctx)).toMatchObject({ complete: true, children: [{ consentComplete: true }] });

    // A second child without consent makes it incomplete again; a child being deleted is left out.
    const { user: second } = await createLearner({ familyId: family.id, nickname: "Josh", now: NOW });
    expect((await getParentOnboarding(ctx)).complete).toBe(false);
    await db.update(user).set({ status: "pending_deletion" }).where(eq(user.id, second.id));
    expect(await getParentOnboarding(ctx)).toMatchObject({ complete: true, children: [{ nickname: "Maya" }] });
  });
});

describe("after sign-in", () => {
  it("routes a learner to onboarding, then home, and copies their saved accessibility preferences", async () => {
    const { user: learner, ctx } = await newLearner();
    const fresh = await ctxForUser(ctx, learner.id);
    expect(fresh.actor).toMatchObject({ type: "learner", userId: learner.id, status: "active" });
    expect(await resolveAfterSignIn(fresh)).toEqual({ path: "/onboarding", a11y: null, facts: { kind: "learner", status: "active", onboardingCompleted: false } });

    await saveInterests(ctx, ["music", "games", "apps"]);
    await saveAccessibility(ctx, { theme: "contrast", reading: "dyslexia", text: "125", motion: "reduce" });
    await completeOnboarding(ctx);
    const after = await resolveAfterSignIn(fresh, "/portfolio");
    expect(after.path).toBe("/portfolio");
    expect(after.a11y).toEqual({ theme: "contrast", reading: "dyslexia", text: "125", motion: "reduce" });
    expect((await resolveAfterSignIn(fresh, "/parent/billing")).path).toBe("/home");
    expect((await resolveAfterSignIn(fresh, "https://evil.example")).path).toBe("/home");
  });

  it("never writes a cookie for someone with no saved preferences, or for a parent", async () => {
    const { ctx } = await newLearner();
    expect(await savedA11yPrefs(ctx)).toBeNull();
    const parent = await createParent();
    expect(await savedA11yPrefs(testCtx(parent.actor, { now: NOW }))).toBeNull();
  });

  it("routes a parent to onboarding until they have a child, then the dashboard", async () => {
    const { actor, family, user: parent } = await createParent();
    const ctx = await ctxForUser(testCtx(undefined, { now: NOW }), parent.id);
    expect(ctx.actor).toEqual(actor);
    expect((await resolveAfterSignIn(ctx)).path).toBe("/parent/onboarding");
    expect((await resolveAfterSignIn(ctx, "/approve/some-token")).path).toBe("/approve/some-token");
    await createLearner({ familyId: family.id, now: NOW });
    expect(await signedInFacts(ctx)).toEqual({ kind: "parent", hasChildren: true });
    expect((await resolveAfterSignIn(ctx)).path).toBe("/parent");
    expect((await resolveAfterSignIn(ctx, "/parent/notices")).path).toBe("/parent/notices");
    expect((await resolveAfterSignIn(ctx, "/studio")).path).toBe("/parent");
  });

  it("routes a waiting teen to the waiting page and a paused learner home", async () => {
    const pending = await createLearner({ status: "pending_parent", now: NOW });
    expect((await resolveAfterSignIn(testCtx(pending.actor, { now: NOW }), "/explore")).path).toBe("/signup/teen/waiting");
    const paused = await newLearner({ status: "paused" });
    expect((await resolveAfterSignIn(paused.ctx)).path).toBe("/home");
  });

  it("routes staff by their two-step state", async () => {
    const staff = await createStaff({ roles: ["editor"] });
    const unverified = testCtx({ ...staff.actor, twoFactorVerified: false }, { now: NOW });
    expect((await resolveAfterSignIn(unverified, "/studio/review")).path).toBe("/signin/two-factor/setup");
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, staff.user.id));
    expect((await resolveAfterSignIn(unverified, "/studio/review")).path).toBe("/signin/two-factor");
    const verified = testCtx({ ...staff.actor, twoFactorVerified: true }, { now: NOW });
    expect((await resolveAfterSignIn(verified, "/studio/review")).path).toBe("/studio/review");
    expect((await resolveAfterSignIn(verified, "/home")).path).toBe("/studio");
  });

  it("sends a signed-out visitor to sign in, whatever they asked for", async () => {
    expect((await resolveAfterSignIn(testCtx(undefined, { now: NOW }), "/home")).path).toBe("/signin");
  });

  it("ctxForUser gives nothing to an account that cannot act", async () => {
    const banned = await createLearner({ status: "banned", now: NOW });
    expect((await ctxForUser(testCtx(undefined, { now: NOW }), banned.user.id)).actor).toEqual({ type: "anonymous" });
    expect((await ctxForUser(testCtx(undefined, { now: NOW }), "00000000-0000-4000-8000-000000000000")).actor).toEqual({ type: "anonymous" });
  });
});

describe("messages for a refused sign-in", () => {
  const attempt = async (run: () => Promise<unknown>) => run().then(() => null, (e: unknown) => e);

  it("gives the same answer for a wrong password, an unknown username and a badly shaped one", async () => {
    await newLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    const api = getAuth().api;
    const wrong = signInFailure(await attempt(() => api.signInUsername({ body: { username: "pixel_wren_77", password: "not-the-password" } })), "username");
    const unknown = signInFailure(await attempt(() => api.signInUsername({ body: { username: "nobody_here_12", password: "not-the-password" } })), "username");
    const shape = signInFailure(await attempt(() => api.signInUsername({ body: { username: "a b", password: "not-the-password" } })), "username");
    for (const failure of [wrong, unknown, shape]) {
      expect(failure).toMatchObject({ code: "unauthenticated", message: "That username and password don't match. Check both, then try again." });
    }
  });

  it("is calm about the short lock after repeated wrong passwords, and tells a learner to ask their parent", async () => {
    await newLearner({ username: "pixel_wren_77", password: TEST_PASSWORD });
    const api = getAuth().api;
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) await attempt(() => api.signInUsername({ body: { username: "pixel_wren_77", password: "not-the-password" } }));
    // Even the right password is refused while the lock lasts.
    const locked = signInFailure(await attempt(() => api.signInUsername({ body: { username: "pixel_wren_77", password: TEST_PASSWORD } })), "username") as { code: string; message: string };
    expect(locked.code).toBe("rate_limited");
    expect(locked.message).toBe(LOCKOUT_MESSAGE.username);
    expect(locked.message).toMatch(/Nothing is wrong with your account/);
    expect(locked.message).toMatch(/ask your parent or carer to reset your password/);
    expect(locked.message).not.toMatch(/!|locked out|suspicious|attack/i);
    expect(LOCKOUT_MESSAGE.email).toMatch(/reset your password by email/);
  });

  it("tells a parent who has not confirmed their email what to do", async () => {
    await createParent({ email: "priya@example.test", password: TEST_PASSWORD, emailVerified: false });
    const failure = signInFailure(await attempt(() => getAuth().api.signInEmail({ body: { email: "priya@example.test", password: TEST_PASSWORD } })), "email");
    expect(failure).toMatchObject({ code: "forbidden", message: expect.stringMatching(/hasn't been confirmed yet/) });
  });

  it("passes anything that is not a sign-in refusal straight through", () => {
    const boom = new Error("database is down");
    expect(signInFailure(boom, "email")).toBe(boom);
    expect(twoFactorFailure(boom)).toBe(boom);
    expect(passwordFailure(boom, "fallback")).toBe(boom);
  });

  it("explains a wrong or expired two-step code and a weak new password", () => {
    expect(twoFactorFailure({ status: "UNAUTHORIZED", body: { code: "INVALID_CODE" } })).toMatchObject({ code: "invalid_input", fieldErrors: { code: expect.any(Array) } });
    expect(twoFactorFailure({ status: "UNAUTHORIZED", body: { code: "INVALID_TWO_FACTOR_COOKIE" } })).toMatchObject({ code: "unauthenticated" });
    expect(passwordFailure({ status: "BAD_REQUEST", body: { code: "PASSWORD_TOO_COMMON", message: "That password is too easy to guess." } }, "x")).toMatchObject({ message: "That password is too easy to guess.", fieldErrors: { password: ["That password is too easy to guess."] } });
    expect(passwordFailure({ status: "BAD_REQUEST", body: { code: "INVALID_TOKEN" } }, "x")).toMatchObject({ message: expect.stringMatching(/run out/) });
  });
});

describe("no service returns the learner placeholder email", () => {
  it("across family, consent, onboarding and sign-in reads for the same learner", async () => {
    const { actor: parentActor, family } = await createParent();
    const { user: learner, actor } = await createLearner({ familyId: family.id, now: NOW });
    expect(learner.email).toMatch(/@learner\.invalid$/); // it is in the database, and only there
    const parentCtx = testCtx(parentActor, { now: NOW });
    const learnerCtx = testCtx<LearnerActor>(actor, { now: NOW });
    const { getLearnerSummary, listChildren, getFamily } = await import("@/server/services/family");
    const { getConsentCentre } = await import("@/server/services/consent");
    const { getAgeAssurance } = await import("@/server/services/age-assurance");
    const { getIndependenceState } = await import("@/server/services/independence");
    const { getPendingTeenStatus } = await import("@/server/services/teen-signup");
    const everything = [
      await getLearnerSummary(parentCtx, learner.id),
      await listChildren(parentCtx, family.id),
      await getFamily(parentCtx, family.id),
      await getConsentCentre(parentCtx, learner.id),
      await saveConsents(parentCtx, learner.id, { choices: REQUIRED_TICKED }),
      await getAgeAssurance(parentCtx, learner.id),
      await getParentOnboarding(testCtx<ParentActor>(parentActor, { now: NOW })),
      await getLearnerOnboarding(learnerCtx),
      await getIndependenceState(learnerCtx),
      await getPendingTeenStatus(learnerCtx),
      await resolveAfterSignIn(learnerCtx),
      await ctxForUser(learnerCtx, learner.id).then((c) => c.actor),
    ];
    expectNoPlaceholderEmail(everything);
  });
});
