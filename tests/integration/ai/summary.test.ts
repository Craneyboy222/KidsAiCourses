/**
 * What a parent may see of Coach use (spec 3.6): a count, topics and the last-used time.
 * Topics come from course and step titles only. Message text is never read: this is proved here
 * by having the learner type distinctive words and checking none of them can reach the summary.
 *
 * `usage`, `entitlements` and `safeguarding` are mocked (contract bodies not written yet).
 */
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { topicsFor } from "@/server/ai/store";
import * as crypto from "@/server/crypto";
import { tutorConversation } from "@/server/db";
import { getCoachSummaryForParent, startOfLondonWeek } from "@/server/services/coach-summary";
import { db, testCtx } from "../../helpers/db";
import { NOW, ask, coachCtx, createCoachLearner, harness, messagesFor, resetBetweenTests, setCoachSetting, setUpWorld, type World } from "./helpers";

vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<object>()), getEntitlementForLearner: vi.fn() }));
vi.mock("@/server/services/usage", async (original) => ({ ...(await original<object>()), checkLearningAllowed: vi.fn() }));
vi.mock("@/server/services/safeguarding", async (original) => ({ ...(await original<object>()), openSafeguardingCase: vi.fn() }));

let world: World;
beforeAll(async () => {
  world = await setUpWorld();
});
beforeEach(resetBetweenTests);

const COURSE_TITLE = "Build Your Own Snapchat-Style App";

describe("getCoachSummaryForParent", () => {
  it("is empty before Coach has been used", async () => {
    const learner = await createCoachLearner(world);
    expect(await getCoachSummaryForParent(coachCtx(learner.parent), learner.actor.userId)).toEqual({ messagesThisWeek: 0, messagesTotal: 0, topics: [], lastUsedAt: null });
  });

  it("gives counts, and topics taken from course and step titles only — never from what was typed", async () => {
    const learner = await createCoachLearner(world);
    const h = harness();
    // Monday 9 November is last week; Monday 16 November (NOW) is this week.
    const lastWeek = new Date("2026-11-13T17:00:00Z");
    await h.proxy.chat(coachCtx(learner.actor, { now: lastWeek }), ask("my hamster zebedee chewed the charger so the camera preview is frozen", { stepKey: "s5" }));
    await h.proxy.chat(coachCtx(learner.actor), ask("the purple walrus reply never shows up when i press send"));
    await h.proxy.chat(coachCtx(learner.actor, { now: new Date(NOW.getTime() + 60_000) }), ask("write my english essay on macbeth"));
    const crisis = await h.proxy.chat(coachCtx(learner.actor, { now: new Date(NOW.getTime() + 120_000) }), ask("i dont want to be here anymore"));
    await crisis.settled;

    const decrypt = vi.spyOn(crypto, "decrypt");
    const summary = await getCoachSummaryForParent(coachCtx(learner.parent, { now: new Date(NOW.getTime() + 180_000) }), learner.actor.userId);
    // Nothing was decrypted to build it. (Reading the messages back, as this test file can, does decrypt: the spy is live.)
    expect(decrypt).not.toHaveBeenCalled();
    expect((await messagesFor(learner.actor.userId)).length).toBeGreaterThan(0);
    expect(decrypt).toHaveBeenCalled();
    decrypt.mockRestore();

    expect(summary.messagesTotal).toBe(4);
    expect(summary.messagesThisWeek).toBe(3);
    expect(summary.lastUsedAt).toEqual(new Date(NOW.getTime() + 120_000));
    expect(summary.topics).toEqual(expect.arrayContaining([COURSE_TITLE, "Create two AI friend characters and wire a pretend chat", "Three built-in filters plus your signature filter"]));
    expect(summary.topics.length).toBeLessThanOrEqual(8);
    const everything = JSON.stringify(summary);
    expect(everything).not.toMatch(/hamster|zebedee|walrus|macbeth|essay|be here anymore|crisis|flag/i);
    // The parent sees a count, not that one message got the crisis script: safety notices are a separate, deliberate channel.
    expect(Object.keys(summary).sort()).toEqual(["lastUsedAt", "messagesThisWeek", "messagesTotal", "topics"]);
  });

  it("does not count staff previews, sign-in or energy denials, or rate-limited attempts", async () => {
    const learner = await createCoachLearner(world);
    const h = harness();
    await h.proxy.chat(coachCtx(learner.actor), ask("how do i start"));
    await setCoachSetting("coach.kill_switch", true);
    await h.proxy.chat(coachCtx(learner.actor), ask("how do i add the timer"));
    await setCoachSetting("coach.kill_switch", false);
    await h.proxy.chat(coachCtx(world.editor), ask("how do i start", { preview: { versionId: world.versionId } }));

    const summary = await getCoachSummaryForParent(coachCtx(learner.parent), learner.actor.userId);
    expect(summary).toMatchObject({ messagesTotal: 1, messagesThisWeek: 1 });
  });

  it("can be read by the learner and by a parent in their family, and by nobody else", async () => {
    const learner = await createCoachLearner(world);
    const stranger = await createCoachLearner(world);
    await expect(getCoachSummaryForParent(coachCtx(learner.actor), learner.actor.userId)).resolves.toMatchObject({ messagesTotal: 0 });
    await expect(getCoachSummaryForParent(coachCtx(learner.parent), learner.actor.userId)).resolves.toMatchObject({ messagesTotal: 0 });
    await expect(getCoachSummaryForParent(coachCtx(stranger.parent), learner.actor.userId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getCoachSummaryForParent(coachCtx(stranger.actor), learner.actor.userId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getCoachSummaryForParent(testCtx(), learner.actor.userId)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("keeps the topics after the message content has been swept", async () => {
    const learner = await createCoachLearner(world);
    await harness().proxy.chat(coachCtx(learner.actor), ask("how do i start"));
    await db.execute("DELETE FROM ai_message");
    await db.update(tutorConversation).set({ contentDeletedAt: NOW }).where(eq(tutorConversation.learnerId, learner.actor.userId));
    const summary = await getCoachSummaryForParent(coachCtx(learner.parent), learner.actor.userId);
    expect(summary.messagesTotal).toBe(1);
    expect(summary.topics).toContain(COURSE_TITLE);
  });
});

describe("helpers", () => {
  it("the week starts on Monday at midnight, UK time, in winter and in summer", () => {
    expect(startOfLondonWeek(new Date("2026-11-16T10:00:00Z"))).toEqual(new Date("2026-11-16T00:00:00Z"));
    expect(startOfLondonWeek(new Date("2026-11-22T23:59:00Z"))).toEqual(new Date("2026-11-16T00:00:00Z"));
    expect(startOfLondonWeek(new Date("2026-06-17T12:00:00Z"))).toEqual(new Date("2026-06-14T23:00:00Z"));
    // 23:30 UTC on a Sunday in summer is already Monday in London.
    expect(startOfLondonWeek(new Date("2026-06-14T23:30:00Z"))).toEqual(new Date("2026-06-14T23:00:00Z"));
  });

  it("topics are the course and step titles, de-duplicated, and nothing else", () => {
    expect(topicsFor({ courseId: null, stepId: null, enrolmentId: null, courseTitle: " Make a Track ", stepTitle: "Pick a beat" })).toEqual(["Make a Track", "Pick a beat"]);
    expect(topicsFor({ courseId: null, stepId: null, enrolmentId: null, courseTitle: "Same", stepTitle: "Same" })).toEqual(["Same"]);
    expect(topicsFor(null)).toEqual([]);
  });
});
