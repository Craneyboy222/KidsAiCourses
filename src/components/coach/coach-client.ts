import type { CoachDoneEvent, CoachErrorBody, CoachMetaEvent } from "@/server/ai/wire";
import type { EnergyView } from "@/server/ai/types";

/**
 * The browser side of the Coach API. It talks only to our own server (`/api/v1/ai/*`): no client
 * code ever calls a model provider (spec 3.5).
 */
export type CoachChatBody = {
  courseSlug: string;
  stepKey: string;
  message: string;
  conversationId?: string;
  preview?: { versionId: string; asBand?: "teen_13_15" | "teen_16_17" | "adult_18"; turn?: number };
};

export type CoachHandlers = {
  onMeta(meta: CoachMetaEvent): void;
  onDelta(text: string): void;
  onDone(done: CoachDoneEvent): void;
};

export type CoachSendResult = { ok: true } | { ok: false; code: string; message: string };

const OFFLINE: CoachSendResult = { ok: false, code: "network", message: "Coach couldn't be reached. Check your connection and try again." };
const BROKEN: CoachSendResult = { ok: false, code: "ai_unavailable", message: "Coach can't answer right now. Your steps and hints still work — try again in a little while." };

/** Splits a Server-Sent Events buffer into complete events, returning what is left over. */
export function parseSseBuffer(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

function dispatch(event: { event: string; data: string }, handlers: CoachHandlers): void {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }
  if (event.event === "meta") handlers.onMeta(payload as CoachMetaEvent);
  else if (event.event === "delta" && typeof (payload as { text?: unknown }).text === "string") handlers.onDelta((payload as { text: string }).text);
  else if (event.event === "done") handlers.onDone(payload as CoachDoneEvent);
}

export async function sendCoachMessage(body: CoachChatBody, handlers: CoachHandlers, signal?: AbortSignal): Promise<CoachSendResult> {
  let response: Response;
  try {
    response = await fetch("/api/v1/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch {
    return OFFLINE;
  }

  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("text/event-stream")) {
    try {
      const parsed = (await response.json()) as Partial<CoachErrorBody>;
      if (parsed.error && typeof parsed.error.message === "string") return { ok: false, code: String(parsed.error.code), message: parsed.error.message };
    } catch {
      // Not JSON: fall through to the generic message.
    }
    return BROKEN;
  }

  try {
    if (!response.body) {
      const { events } = parseSseBuffer(`${await response.text()}\n\n`);
      for (const event of events) dispatch(event, handlers);
      return { ok: true };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBuffer(done ? `${buffer}\n\n` : buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) dispatch(event, handlers);
      if (done) break;
    }
    return { ok: true };
  } catch {
    return OFFLINE;
  }
}

export async function fetchEnergy(signal?: AbortSignal): Promise<EnergyView | null> {
  try {
    const response = await fetch("/api/v1/ai/credits", { credentials: "same-origin", signal });
    if (!response.ok) return null;
    const parsed = (await response.json()) as { energy?: EnergyView };
    return parsed.energy ?? null;
  } catch {
    return null;
  }
}
