/**
 * What the Coach API sends to the browser, and how. Kept apart from the route so that the shape
 * can be tested: the response must never carry `coachContext`, the system prompt, hints the
 * learner has not opened, or a solution. Only the fields listed here ever leave the server.
 */
import { chunkForStreaming } from "./proxy";
import type { CoachResult, EnergyView } from "./types";

/** First event of a successful stream: everything about the message except its text. */
export type CoachMetaEvent = {
  kind: "reply" | "crisis" | "refusal";
  code: string;
  aiGenerated: boolean;
  label: string;
  notices: string[];
  conversationId: string | null;
  /** The id to report this output with. */
  messageId: string | null;
  crisis: CoachResult["crisis"];
  preview: boolean;
};
export type CoachDoneEvent = { energy: EnergyView | null };
export type CoachErrorBody = { error: { code: string; message: string } };

export function toMetaEvent(result: CoachResult): CoachMetaEvent {
  return {
    kind: result.kind === "denied" ? "refusal" : result.kind,
    code: result.code,
    aiGenerated: result.aiGenerated,
    label: result.label,
    notices: result.notices,
    conversationId: result.conversationId,
    messageId: result.requestId,
    crisis: result.crisis,
    preview: result.preview,
  };
}

const frame = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** The Server-Sent Events frames for an approved result: `meta`, then `delta` chunks, then `done`. */
export function sseFrames(result: CoachResult): string[] {
  return [
    frame("meta", toMetaEvent(result)),
    ...chunkForStreaming(result.message).map((text) => frame("delta", { text })),
    frame("done", { energy: result.energy } satisfies CoachDoneEvent),
  ];
}

/**
 * The HTTP response for a pipeline result. `denied` results are JSON errors with their status;
 * everything else is an event stream of text that has already passed every check.
 */
export function coachResponse(result: CoachResult): Response {
  if (result.kind === "denied") {
    const body: CoachErrorBody = { error: { code: result.code, message: result.message } };
    return Response.json(body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  }
  const frames = sseFrames(result);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const part of frames) {
        controller.enqueue(encoder.encode(part));
        // Let each chunk leave before the next, so the text arrives as a stream rather than a lump.
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
