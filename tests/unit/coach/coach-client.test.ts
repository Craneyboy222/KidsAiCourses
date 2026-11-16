import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEnergy, parseSseBuffer, sendCoachMessage, type CoachHandlers } from "@/components/coach/coach-client";

afterEach(() => vi.unstubAllGlobals());

const meta = { kind: "reply", code: "ok", aiGenerated: true, label: "AI-generated", notices: [], conversationId: "c-1", messageId: "m-1", crisis: null, preview: false };
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const body = { courseSlug: "a-course", stepKey: "s1", message: "hello" };

function recorder(): { handlers: CoachHandlers; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    handlers: { onMeta: (m) => void seen.push(`meta:${m.label}`), onDelta: (text) => void seen.push(`delta:${text}`), onDone: (done) => void seen.push(`done:${done.energy?.balance ?? "none"}`) },
  };
}

/** A response whose body arrives in the given pieces, however awkwardly they are cut. */
function streamed(pieces: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

describe("parseSseBuffer", () => {
  it("returns complete events and keeps an unfinished one for the next chunk", () => {
    const whole = frame("meta", meta) + frame("delta", { text: "Hi" });
    const cut = whole.length - 9;
    const first = parseSseBuffer(whole.slice(0, cut));
    expect(first.events.map((e) => e.event)).toEqual(["meta"]);
    const second = parseSseBuffer(first.rest + whole.slice(cut));
    expect(second.events).toEqual([{ event: "delta", data: JSON.stringify({ text: "Hi" }) }]);
    expect(second.rest).toBe("");
  });

  it("copes with CRLF line endings and multi-line data", () => {
    expect(parseSseBuffer("event: delta\r\ndata: {\"text\":\r\ndata: \"a\"}\r\n\r\n").events).toEqual([{ event: "delta", data: '{"text":\n"a"}' }]);
  });
});

describe("sendCoachMessage", () => {
  it("posts to our own API only, and hands events over in order however the stream is cut up", async () => {
    const whole = frame("meta", meta) + frame("delta", { text: "What have " }) + frame("delta", { text: "you tried?" }) + frame("done", { energy: { balance: 49, monthlyAllowance: 50, percent: 98, resetsAt: "2026-12-01T00:00:00.000Z" } });
    const pieces = [whole.slice(0, 7), whole.slice(7, 150), whole.slice(150, 151), whole.slice(151)];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => streamed(pieces));
    vi.stubGlobal("fetch", fetchMock);
    const { handlers, seen } = recorder();
    expect(await sendCoachMessage(body, handlers)).toEqual({ ok: true });
    expect(seen).toEqual(["meta:AI-generated", "delta:What have ", "delta:you tried?", "done:49"]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/ai/chat");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it("turns a JSON error from the API into its code and friendly message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "ai_break", message: "AI break — back soon." } }, { status: 503 })));
    const { handlers, seen } = recorder();
    expect(await sendCoachMessage(body, handlers)).toEqual({ ok: false, code: "ai_break", message: "AI break — back soon." });
    expect(seen).toEqual([]);
  });

  it("has a safe message for a broken answer and for no connection, and never throws", async () => {
    const { handlers } = recorder();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })));
    expect(await sendCoachMessage(body, handlers)).toMatchObject({ ok: false, code: "ai_unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not an event stream", { status: 200, headers: { "content-type": "text/plain" } })));
    expect(await sendCoachMessage(body, handlers)).toMatchObject({ ok: false, code: "ai_unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await sendCoachMessage(body, handlers)).toMatchObject({ ok: false, code: "network" });
  });

  it("ignores an event it cannot read rather than showing rubbish", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamed(["event: delta\ndata: {not json}\n\n", frame("delta", { text: 42 }), frame("delta", { text: "ok" })])));
    const { handlers, seen } = recorder();
    expect(await sendCoachMessage(body, handlers)).toEqual({ ok: true });
    expect(seen).toEqual(["delta:ok"]);
  });
});

describe("fetchEnergy", () => {
  it("returns the energy view, or nothing when it cannot be had", async () => {
    const energy = { balance: 12, monthlyAllowance: 50, percent: 24, resetsAt: "2026-12-01T00:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ energy })));
    expect(await fetchEnergy()).toEqual(energy);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "forbidden", message: "No." } }, { status: 403 })));
    expect(await fetchEnergy()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await fetchEnergy()).toBeNull();
  });
});
