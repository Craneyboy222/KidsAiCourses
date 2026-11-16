/**
 * The player's progress sessions on their own, with a fake server behind `fetch` and fake timers:
 * debounced autosave, retry, "save first, then stop", and a preview that never talks to the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STEP, LiveSession, PreviewSession, RETRY_DELAYS_MS, SAVE_DELAY_MS, previewStorageKey, type StepMeta } from "@/components/course/player/session";

const step = (patch: Partial<StepMeta> = {}): StepMeta => ({ key: "s3", type: "external_task", rule: "self_tick", threshold: null, hintCount: 3, guideStepIds: [], disabled: false, videoPlayable: true, ...patch });

type Call = { url: string; method: string; body: Record<string, unknown>; keepalive: boolean };

function fakeServer(respond: (call: Call) => { status?: number; json: unknown } | "offline") {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, keepalive: init?.keepalive === true };
    calls.push(call);
    const answer = respond(call);
    if (answer === "offline") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.json), { status: answer.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const saved = (patch: Record<string, unknown> = {}) => ({ json: { saved: true, status: "in_progress", data: {}, completion: null, stopped: null, ...patch } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LiveSession", () => {
  const live = (server: ReturnType<typeof fakeServer>, meta = step()) => new LiveSession({ enrolmentId: "e1", step: meta, initial: { statuses: {}, current: EMPTY_STEP }, fetchImpl: server.fetchImpl });

  it("debounces typing into one save and shows Saving then Saved", async () => {
    const server = fakeServer(() => saved());
    const session = live(server);
    session.update({ notes: "T" });
    session.update({ notes: "Tr" });
    session.update({ notes: "Try" });
    expect(session.getState().saveStatus).toBe("saving");
    expect(session.getState().current.notes).toBe("Try");
    expect(server.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(server.calls).toEqual([{ url: "/api/v1/enrolments/e1/steps/s3", method: "PUT", body: { intent: "save", notes: "Try" }, keepalive: false }]);
    expect(session.getState().saveStatus).toBe("saved");
  });

  it("keeps the work and retries when the network drops, then saves the latest text", async () => {
    let online = false;
    const server = fakeServer(() => (online ? saved() : "offline"));
    const session = live(server);
    session.update({ response: "first" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(session.getState().saveStatus).toBe("retrying");

    // More typing while offline: the retry carries the newest words, not the ones that failed.
    session.update({ response: "first and second" });
    online = true;
    await vi.advanceTimersByTimeAsync(Math.max(SAVE_DELAY_MS, RETRY_DELAYS_MS[0]));
    expect(server.calls.at(-1)?.body).toEqual({ intent: "save", response: "first and second" });
    expect(session.getState().saveStatus).toBe("saved");
    expect(session.getState().current.response).toBe("first and second");
  });

  it("does not retry when the server refuses, and says so", async () => {
    const server = fakeServer(() => ({ status: 422, json: { error: { code: "invalid_input", message: "That's too long to save." } } }));
    const session = live(server);
    session.update({ notes: "x" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 30_000);
    expect(server.calls).toHaveLength(1);
    expect(session.getState().saveStatus).toBe("failed");
  });

  it("saves first, then stops, when the daily cap arrives", async () => {
    const stopped = { reason: "time_cap", message: "That's your learning time for today." };
    const server = fakeServer(() => saved({ stopped }));
    const session = live(server);
    session.update({ response: "the sentence I was in the middle of" });
    const result = await session.complete();

    // The words went to the server in a save BEFORE anything else was asked of it.
    expect(server.calls[0]?.body).toEqual({ intent: "save", response: "the sentence I was in the middle of" });
    expect(server.calls).toHaveLength(1);
    expect(result).toEqual({ ok: false, message: stopped.message });
    expect(session.getState().stopped).toEqual(stopped);
    expect(session.getState().saveStatus).toBe("saved");
  });

  it("lets the server decide completion, and passes on its reason", async () => {
    const server = fakeServer((call) => (call.body.intent === "complete" ? saved({ completion: { complete: false, code: "tick_needed", message: "Tick the box to say you've done this." } }) : saved()));
    const session = live(server);
    expect(await session.complete()).toEqual({ ok: false, message: "Tick the box to say you've done this." });
    expect(session.getState().current.status).toBe("in_progress");

    const yes = fakeServer(() => saved({ status: "completed" }));
    const done = live(yes);
    expect(await done.complete()).toEqual({ ok: true });
    expect(done.getState().statuses).toEqual({ s3: "completed" });
    // Already complete: nothing more is sent.
    await done.complete();
    expect(yes.calls).toHaveLength(1);
  });

  it("stops on a paused account or quiet hours reported by the API", async () => {
    const server = fakeServer(() => ({ status: 403, json: { error: { code: "quiet_hours", message: "It's quiet hours until 07:00." } } }));
    const session = live(server);
    expect(await session.skip()).toEqual({ ok: false, message: "It's quiet hours until 07:00." });
    expect(session.getState().stopped).toEqual({ reason: "quiet_hours", message: "It's quiet hours until 07:00." });
  });

  it("refuses to skip the final step without asking the server", async () => {
    const server = fakeServer(() => saved());
    const session = live(server, step({ key: "s12", type: "submit", rule: "submit" }));
    expect((await session.skip()).ok).toBe(false);
    expect(server.calls).toHaveLength(0);
  });

  it("sends unsaved work at once, in a keepalive request, when the tab is hidden", async () => {
    const server = fakeServer(() => saved());
    const session = live(server);
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls[0]?.body).toEqual({ intent: "open" });

    session.update({ notes: "about to close the laptop" });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls.at(-1)).toMatchObject({ body: { intent: "save", notes: "about to close the laptop" }, keepalive: true });

    // Leaving the step also flushes, and the debounce does not send it a second time.
    session.update({ notes: "one more thing" });
    session.dispose();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(server.calls.filter((call) => call.body.notes === "one more thing")).toHaveLength(1);
  });

  it("sends a quiz to be marked and records a pass", async () => {
    const server = fakeServer((call) => (call.url.endsWith("/quiz-attempts") ? { json: { score: 100, passMark: 66, passed: true, correctCount: 3, total: 3, questions: [], attemptNumber: 2 } } : saved()));
    const session = live(server, step({ key: "s9", type: "quiz", rule: "quiz_pass" }));
    const outcome = await session.submitQuiz({ q1: ["a"] });
    expect(server.calls[0]).toMatchObject({ url: "/api/v1/enrolments/e1/steps/s9/quiz-attempts", method: "POST", body: { answers: { q1: ["a"] } } });
    expect("error" in outcome).toBe(false);
    expect(session.getState().current).toMatchObject({ status: "completed", quiz: { attempts: 1, passed: true, bestScore: 100 } });
  });

  it("does nothing on a step that staff have switched off", async () => {
    const server = fakeServer(() => saved());
    const session = live(server, step({ disabled: true }));
    session.start();
    session.update({ notes: "x" });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(await session.complete()).toEqual({ ok: true });
    expect(server.calls).toHaveLength(0);
  });
});

describe("PreviewSession", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  }
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps progress in the tab's storage and never calls the server", async () => {
    const storage = memoryStorage();
    const session = new PreviewSession({ versionId: "v1", step: step(), order: ["s1", "s3"], storage });
    session.start();
    expect(session.getState().statuses).toEqual({ s1: "not_started", s3: "in_progress" });

    expect(await session.complete()).toMatchObject({ ok: false });
    session.update({ data: { ticked: true }, notes: "preview note" });
    expect(await session.complete()).toEqual({ ok: true });
    expect(session.getState().current.status).toBe("completed");

    // Another step in the same preview sees it; another version does not.
    const next = new PreviewSession({ versionId: "v1", step: step({ key: "s1", type: "read", rule: "view" }), order: ["s1", "s3"], storage });
    next.start();
    expect(next.getState().statuses).toEqual({ s1: "in_progress", s3: "completed" });
    const other = new PreviewSession({ versionId: "v2", step: step(), order: ["s1", "s3"], storage });
    other.start();
    expect(other.getState().statuses.s3).toBe("in_progress");
    expect([...storage.data.keys()].sort()).toEqual([previewStorageKey("v1"), previewStorageKey("v2")]);

    await session.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("applies the same completion rules as the live course", async () => {
    const storage = memoryStorage();
    const video = new PreviewSession({ versionId: "v1", step: step({ key: "s1", type: "video", rule: "view", threshold: 0.8 }), order: ["s1"], storage });
    video.start();
    expect((await video.complete()).ok).toBe(false);
    video.update({ data: { watchedFraction: 0.9 } });
    expect((await video.complete()).ok).toBe(true);

    // A video that cannot be played never holds anyone back.
    const broken = new PreviewSession({ versionId: "v1", step: step({ key: "s2", type: "video", rule: "view", videoPlayable: false }), order: ["s2"], storage: memoryStorage() });
    broken.start();
    expect((await broken.complete()).ok).toBe(true);

    const submit = new PreviewSession({ versionId: "v1", step: step({ key: "s12", type: "submit", rule: "submit" }), order: ["s12"], storage: memoryStorage() });
    submit.start();
    expect((await submit.skip()).ok).toBe(false);
    expect((await submit.complete()).ok).toBe(true);
  });

  it("marks a quiz through the grader it is given, and survives corrupt storage", async () => {
    const storage = memoryStorage();
    storage.data.set(previewStorageKey("v1"), "{not json");
    const grade = vi.fn(async () => ({ score: 50, passMark: 66, passed: false, correctCount: 1, total: 2, questions: [], attemptNumber: 0 }));
    const session = new PreviewSession({ versionId: "v1", step: step({ key: "s9", type: "quiz", rule: "quiz_pass" }), order: ["s9"], storage, grade });
    session.start();
    await session.submitQuiz({ q1: ["a"] });
    expect(grade).toHaveBeenCalledWith("v1", "s9", { q1: ["a"] });
    expect(session.getState().current).toMatchObject({ status: "in_progress", quiz: { attempts: 1, passed: false, bestScore: 50 } });

    const none = new PreviewSession({ versionId: "v1", step: step({ key: "s9", type: "quiz", rule: "quiz_pass" }), order: ["s9"], storage });
    expect(await none.submitQuiz({})).toEqual({ error: "Quiz marking isn't available in this preview." });
  });
});
