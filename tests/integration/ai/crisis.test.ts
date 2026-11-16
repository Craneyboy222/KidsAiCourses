/**
 * The crisis pathway on real Postgres (spec 3.5 and Section 9, "DSL workflow").
 *
 * A disclosure gets the FIXED script: never model text, no model call, no credits. A safeguarding
 * case is opened without delaying the script; if that fails it is retried and logged, and the
 * learner never sees an error. The conversation is flagged and kept for the DSL only.
 *
 * `safeguarding.openSafeguardingCase` is mocked (its contract body is not written yet); the mock
 * inserts a real `safeguarding_case` row. `usage` and `entitlements` are mocked for the same reason.
 */
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getCrisisScript, renderCrisisText } from "@/server/ai/crisis";
import { FIXED_LABEL, type CoachResult } from "@/server/ai/proxy";
import { readFlaggedConversation } from "@/server/ai/store";
import { coachResponse } from "@/server/ai/wire";
import { auditLog, safeguardingCase } from "@/server/db";
import { AppError } from "@/server/errors";
import { openSafeguardingCase } from "@/server/services/safeguarding";
import { db } from "../../helpers/db";
import { createStaff } from "../../helpers/factories";
import {
  NOW,
  RATE_LIMITS,
  aiRequestsFor,
  ask,
  balanceFor,
  coachCtx,
  conversationsFor,
  createCoachLearner,
  harness,
  ledgerFor,
  messagesFor,
  mocks,
  resetBetweenTests,
  setCoachSetting,
  setUpWorld,
  type Harness,
  type World,
} from "./helpers";

vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<object>()), getEntitlementForLearner: vi.fn() }));
vi.mock("@/server/services/usage", async (original) => ({ ...(await original<object>()), checkLearningAllowed: vi.fn() }));
vi.mock("@/server/services/safeguarding", async (original) => ({ ...(await original<object>()), openSafeguardingCase: vi.fn() }));

const DAY_MS = 24 * 60 * 60 * 1000;
const DISCLOSURE = "i dont want to be here anymore";

let world: World;
beforeAll(async () => {
  world = await setUpWorld();
});
beforeEach(resetBetweenTests);

/** The fixed script, whole, labelled as a set message; no model was called and nothing was charged. */
function expectScript(result: CoachResult, h: Harness): void {
  expect(result).toMatchObject({ kind: "crisis", code: "crisis", outcome: "crisis", status: 200, aiGenerated: false, label: FIXED_LABEL });
  expect(result.message).toBe(renderCrisisText(getCrisisScript()));
  expect(result.message).toMatch(/Childline: 0800 1111/);
  expect(result.message).toMatch(/Samaritans: 116 123/);
  expect(result.message).toMatch(/Text SHOUT to 85258/);
  expect(result.message).toMatch(/call 999/);
  expect(result.crisis?.contacts.map((contact) => contact.href)).toEqual(["tel:08001111", "tel:116123", "sms:85258?body=SHOUT"]);
  expect(result.crisis?.emergency.contact.href).toBe("tel:999");
  expect(h.modelRequests).toHaveLength(0);
  expect(result.meta.modelCalls).toBe(0);
  expect(result.meta.creditsCharged).toBe(0);
}

describe("a disclosure", () => {
  it("gets the fixed script at once: no model call, no credits, a high-severity case, and a flagged conversation", async () => {
    const learner = await createCoachLearner(world);
    const h = harness();
    const result = await h.proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE));
    expectScript(result, h);
    expect(result.meta.stage).toBe("input_moderation");
    // The next message starts a new conversation: this one is closed to the learner.
    expect(result.conversationId).toBeNull();

    await result.settled;
    expect(result.meta.caseOpened).toBe(true);
    expect(mocks.cases).toHaveLength(1);
    expect(mocks.cases[0]).toMatchObject({ learnerId: learner.actor.userId, severity: "high", trigger: "crisis_classifier", sourceType: "tutor_conversation" });
    // The summary is factual and carries none of the learner's words; those go in the encrypted detail.
    expect(mocks.cases[0]?.summary).toMatch(/crisis script/);
    expect(mocks.cases[0]?.summary).not.toMatch(/be here anymore/);
    expect(mocks.cases[0]?.detail).toBe(DISCLOSURE);

    // No credits: the hold was released, nothing was spent.
    expect((await ledgerFor(learner.actor.userId)).map((row) => row.entryType).sort()).toEqual(["grant", "release", "reserve"]);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ granted: 50, reserved: 0, spent: 0 });

    const [conversation] = await conversationsFor(learner.actor.userId);
    expect(conversation?.flagged).toBe(true);
    expect(conversation?.safeguardingCaseId).toBe((await db.select().from(safeguardingCase).where(eq(safeguardingCase.learnerId, learner.actor.userId)))[0]?.id);
    expect(mocks.cases[0]?.sourceId).toBe(conversation?.id);

    // The learner's message is kept, encrypted and flagged, under the safeguarding schedule (12 months by default).
    const messages = await messagesFor(learner.actor.userId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user", flagged: true, text: DISCLOSURE });
    expect(messages[0]?.contentEncrypted).not.toContain("be here");
    expect(messages[0]?.expiresAt.getTime()).toBe(NOW.getTime() + 365 * DAY_MS);

    const [request] = await aiRequestsFor(learner.actor.userId);
    expect(request).toMatchObject({ outcome: "crisis", creditsCharged: 0, inputTokens: 0, outputTokens: 0, model: null });
    expect(JSON.stringify(request)).not.toContain("be here anymore");
  });

  it("is streamed as the script with tappable contacts and is never labelled AI-generated", async () => {
    const learner = await createCoachLearner(world);
    const response = coachResponse(await harness().proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE)));
    expect(response.status).toBe(200);
    const body = await response.text();
    const meta = JSON.parse((body.split("\n\n")[0] ?? "").split("\ndata: ")[1] ?? "{}") as { kind: string; aiGenerated: boolean; label: string; crisis: { contacts: Array<{ display: string }> } };
    expect(meta).toMatchObject({ kind: "crisis", aiGenerated: false, label: FIXED_LABEL });
    expect(meta.crisis.contacts.map((contact) => contact.display)).toEqual(["0800 1111", "116 123", "Text SHOUT to 85258"]);
  });

  it.each([
    ["immediate danger", "he has a knife and hes outside my door, im scared", "critical", "crisis_classifier"],
    ["a disclosure involving sexual content and a minor", "my uncle made me watch porn with him, im 13 years old", "critical", "abuse_disclosure"],
    ["abuse", "my dad hits me", "high", "abuse_disclosure"],
    ["grooming", "he said its our secret and i cant tell my mum", "high", "grooming"],
    ["exploitation", "hes threatening to post my nudes if i dont send more", "high", "exploitation"],
    ["self-harm", "i been cutting again and i cant stop", "high", "crisis_classifier"],
  ])("%s opens a %s case", async (_what, message, _label, trigger) => {
    const learner = await createCoachLearner(world);
    const h = harness();
    const result = await h.proxy.chat(coachCtx(learner.actor), ask(message));
    await result.settled;
    expectScript(result, h);
    expect(mocks.cases).toHaveLength(1);
    expect(mocks.cases[0]).toMatchObject({ severity: _label, trigger });
  });

  it("does not wait for the safeguarding case before answering", async () => {
    const learner = await createCoachLearner(world);
    let finishOpening: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finishOpening = resolve;
    });
    const real = vi.mocked(openSafeguardingCase).getMockImplementation();
    vi.mocked(openSafeguardingCase).mockImplementation(async (ctx, input) => {
      await gate;
      if (!real) throw new Error("no implementation");
      return real(ctx, input);
    });
    const h = harness();
    const result = await h.proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE));
    // The script is back while the case is still being opened.
    expectScript(result, h);
    expect(result.meta.caseOpened).toBe(false);
    expect(await db.select().from(safeguardingCase).where(eq(safeguardingCase.learnerId, learner.actor.userId))).toHaveLength(0);

    finishOpening?.();
    await result.settled;
    expect(result.meta.caseOpened).toBe(true);
    expect(await db.select().from(safeguardingCase).where(eq(safeguardingCase.learnerId, learner.actor.userId))).toHaveLength(1);
  });

  it("retries when the case cannot be opened, logs each failure, and never shows the learner an error", async () => {
    const learner = await createCoachLearner(world);
    mocks.failCaseOpens = 2;
    const h = harness();
    const result = await h.proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE));
    expectScript(result, h);
    await result.settled;
    expect(mocks.cases).toHaveLength(3);
    expect(h.logs.filter((log) => log.event === "coach.crisis.case_open_failed")).toHaveLength(2);
    expect(result.meta.caseOpened).toBe(true);
    expect((await conversationsFor(learner.actor.userId))[0]?.safeguardingCaseId).not.toBeNull();
  });

  it("when every attempt fails, the script is still shown, the failure is logged loudly, and the conversation stays flagged for the DSL", async () => {
    const learner = await createCoachLearner(world);
    mocks.failCaseOpens = 99;
    const h = harness();
    const result = await h.proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE));
    expectScript(result, h);
    await expect(result.settled).resolves.toBeUndefined();
    expect(mocks.cases).toHaveLength(4);
    expect(result.meta.caseOpened).toBe(false);
    expect(h.logs.map((log) => log.event)).toContain("coach.crisis.CASE_NOT_OPENED");
    expect(h.logs.every((log) => log.level === "error")).toBe(true);
    const [conversation] = await conversationsFor(learner.actor.userId);
    expect(conversation).toMatchObject({ flagged: true, safeguardingCaseId: null });
  });

  it("starts a fresh conversation afterwards and never feeds the flagged one back to the model", async () => {
    const learner = await createCoachLearner(world);
    const h = harness();
    const first = await h.proxy.chat(coachCtx(learner.actor), ask("the chat reply never shows up when i press send"));
    const crisis = await h.proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE, { conversationId: first.conversationId ?? undefined }));
    await crisis.settled;
    expect(crisis.kind).toBe("crisis");
    // Everything in the conversation now follows the safeguarding schedule.
    for (const message of await messagesFor(learner.actor.userId)) {
      expect(message.flagged).toBe(true);
      expect(message.expiresAt.getTime()).toBe(NOW.getTime() + 365 * DAY_MS);
    }

    // The browser may still hold the old id. The pipeline carries on in a new conversation.
    const next = await h.proxy.chat(coachCtx(learner.actor), ask("ok. how do i make the timer work", { conversationId: first.conversationId ?? undefined }));
    expect(next.kind).toBe("reply");
    expect(next.conversationId).not.toBe(first.conversationId);
    expect(h.modelRequests.at(-1)?.messages).toEqual([{ role: "user", content: "ok. how do i make the timer work" }]);
    expect(JSON.stringify(h.modelRequests)).not.toContain("be here anymore");
  });

  it("is only readable by the DSL, with a reason, and every read is audited", async () => {
    const learner = await createCoachLearner(world);
    const result = await harness().proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE));
    await result.settled;
    const [conversation] = await conversationsFor(learner.actor.userId);
    const id = conversation?.id ?? "";

    // Not the learner, not their parent, not content staff, not even an admin. (The owner's
    // `super_admin` role may do anything in the authz matrix; at launch the owner is the DSL.)
    const admin = (await createStaff({ roles: ["admin"] })).actor;
    const support = (await createStaff({ roles: ["support", "moderator"] })).actor;
    for (const actor of [learner.actor, learner.parent, world.editor, admin, support]) {
      await expect(readFlaggedConversation(coachCtx(actor), id, "Checking on this learner")).rejects.toBeInstanceOf(AppError);
    }
    const dsl = (await createStaff({ roles: ["dsl"] })).actor;
    await expect(readFlaggedConversation(coachCtx(dsl), id, "  ")).rejects.toMatchObject({ code: "invalid_input" });
    const messages = await readFlaggedConversation(coachCtx(dsl), id, "Following up the crisis alert");
    expect(messages.map((message) => message.content)).toEqual([DISCLOSURE]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "safeguarding.conversation.read"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ targetId: id, reason: "Following up the crisis alert" });
  });
});

describe("the model raising the flag", () => {
  it("shows the fixed script instead of the model's words when the model returns the safeguarding sentinel", async () => {
    const learner = await createCoachLearner(world);
    const h = harness({ outputs: ["[[SAFEGUARDING]]"] });
    const result = await h.proxy.chat(coachCtx(learner.actor), ask("things at home are making it hard to finish this step"));
    await result.settled;
    expect(result).toMatchObject({ kind: "crisis", aiGenerated: false });
    expect(result.message).toBe(renderCrisisText(getCrisisScript()));
    expect(result.message).not.toContain("SAFEGUARDING");
    expect(h.modelRequests).toHaveLength(1);
    expect(result.meta.creditsCharged).toBe(0);
    expect(await balanceFor(learner.actor.userId)).toMatchObject({ reserved: 0, spent: 0 });
    expect(mocks.cases[0]).toMatchObject({ severity: "high", trigger: "crisis_classifier" });
    expect(mocks.cases[0]?.summary).toMatch(/model_flag/);
  });
});

describe("a child in trouble is never answered with 'try again later'", () => {
  const blockers: Array<[string, (learnerId: string) => Promise<void>]> = [
    ["the kill switch is on", async () => setCoachSetting("coach.kill_switch", true)],
    ["Coach is switched off", async () => setCoachSetting("coach.enabled", false)],
    ["it is quiet hours", async () => void (mocks.learning = { allowed: false, reason: "quiet_hours", message: "It's quiet hours." })],
    ["the time cap is reached", async () => void (mocks.learning = { allowed: false, reason: "time_cap", message: "That's your time for today." })],
    ["there is no energy left", async () => void (mocks.entitlement = { ...mocks.entitlement, coachCreditsPerLearnerPerMonth: 0 })],
    ["the rate limit is used up", async () => setCoachSetting("coach.rate_limits", { ...RATE_LIMITS, perUserPerMin: 1 })],
  ];
  it.each(blockers)("when %s, a disclosure still gets the script and a case", async (what, arrange) => {
    const learner = await createCoachLearner(world);
    await arrange(learner.actor.userId);
    const h = harness();
    if (what.startsWith("the rate limit")) await h.proxy.chat(coachCtx(learner.actor), ask("how do i start"));
    const calls = h.modelRequests.length;

    const turnedAway = await h.proxy.chat(coachCtx(learner.actor), ask("how do i add the timer"));
    expect(turnedAway.kind).toBe("denied");

    const result = await h.proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE));
    await result.settled;
    expect(result).toMatchObject({ kind: "crisis", status: 200, aiGenerated: false });
    expect(result.message).toMatch(/0800 1111/);
    expect(h.modelRequests).toHaveLength(calls);
    expect(mocks.cases).toHaveLength(1);
    expect(mocks.cases[0]?.learnerId).toBe(learner.actor.userId);
    expect((await balanceFor(learner.actor.userId))?.spent ?? 0).toBe(calls);
  });

  it("a message far too long to answer is still checked for a disclosure", async () => {
    const learner = await createCoachLearner(world);
    const h = harness();
    const long = `${"i have been trying to fix this for ages and nothing works. ".repeat(60)} honestly i want to kill myself`;
    expect(long.length).toBeGreaterThan(2000);
    const result = await h.proxy.chat(coachCtx(learner.actor), ask(long));
    await result.settled;
    expect(result.kind).toBe("crisis");
    expect(mocks.cases).toHaveLength(1);
    expect(h.modelRequests).toHaveLength(0);
  });

  it("limits repeat alerts, never the script: a fourth disclosure in ten minutes still gets the script, a critical one still opens a case", async () => {
    const learner = await createCoachLearner(world);
    const h = harness();
    for (let i = 0; i < 4; i += 1) {
      const result = await h.proxy.chat(coachCtx(learner.actor), ask(DISCLOSURE));
      await result.settled;
      expect(result.kind).toBe("crisis");
    }
    expect(mocks.cases).toHaveLength(3);
    expect(h.logs.map((log) => log.event)).toContain("coach.crisis.case_suppressed");

    const critical = await h.proxy.chat(coachCtx(learner.actor), ask("he has a knife and hes outside my door, im scared"));
    await critical.settled;
    expect(critical.kind).toBe("crisis");
    expect(mocks.cases).toHaveLength(4);
    expect(mocks.cases[3]?.severity).toBe("critical");
  });
});
