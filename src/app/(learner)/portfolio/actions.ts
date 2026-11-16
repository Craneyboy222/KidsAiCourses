"use server";

import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { requireLearner } from "@/server/context";
import { rateLimit } from "@/server/ratelimit";
import { addLinkEvidence, completeUpload, removeEvidence, requestUpload, submitWork, MAX_NOTE_LENGTH, MAX_TITLE_LENGTH, type EvidenceItem, type SubmitResult } from "@/server/services/submission";
import type { SignedUpload } from "@/server/storage";

/**
 * Evidence and hand-in actions (spec 3.4). Every one is for the signed-in learner on their own
 * enrolment: the service checks ownership, the start gate and the daily limits each time.
 */
type Result<T> = Exclude<ActionState<T>, null>;

const linkSchema = z.object({ enrolmentId: z.uuid(), stepId: z.uuid(), url: z.string().max(2100), declaredNoPeople: z.literal("on").optional() });

export async function addLinkAction(_prev: ActionState<EvidenceItem>, formData: FormData): Promise<ActionState<EvidenceItem>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const input = linkSchema.parse(Object.fromEntries(formData));
    await rateLimit(ctx, "evidence.add", { limit: 60, windowSec: 3600 });
    return addLinkEvidence(ctx, { enrolmentId: input.enrolmentId, stepId: input.stepId, url: input.url, declaredNoPeople: input.declaredNoPeople === "on" });
  });
}

const uploadSchema = z.object({ enrolmentId: z.uuid(), stepId: z.uuid(), kind: z.enum(["screenshot", "file", "video"]), contentType: z.string().max(200), sizeBytes: z.number().int().positive() });

/** Step one of an upload: a short-lived signed link to send the file to. The file's name is never sent. */
export async function requestUploadAction(input: { enrolmentId: string; stepId: string; kind: string; contentType: string; sizeBytes: number }): Promise<Result<{ artefactId: string; upload: Pick<SignedUpload, "url" | "method" | "headers"> }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const parsed = uploadSchema.parse(input);
    await rateLimit(ctx, "evidence.upload", { limit: 40, windowSec: 3600 });
    const ticket = await requestUpload(ctx, parsed);
    return { artefactId: ticket.artefactId, upload: { url: ticket.upload.url, method: ticket.upload.method, headers: ticket.upload.headers } };
  });
}

/** Step two: the browser says the file has arrived. Only now is it checked and, if it passes, kept. */
export async function completeUploadAction(artefactId: string): Promise<Result<EvidenceItem>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    return completeUpload(ctx, { artefactId: z.uuid().parse(artefactId) });
  });
}

export async function removeEvidenceAction(artefactId: string): Promise<Result<{ removed: true }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    await removeEvidence(ctx, { artefactId: z.uuid().parse(artefactId) });
    return { removed: true as const };
  });
}

const submitSchema = z.object({ enrolmentId: z.uuid(), stepId: z.uuid(), title: z.string().max(MAX_TITLE_LENGTH * 4).optional(), note: z.string().max(MAX_NOTE_LENGTH * 4).optional() });

export async function submitWorkAction(_prev: ActionState<SubmitResult>, formData: FormData): Promise<ActionState<SubmitResult>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const fields = Object.fromEntries(formData);
    const input = submitSchema.parse({ enrolmentId: fields.enrolmentId, stepId: fields.stepId, title: fields.title, note: fields.note });
    await rateLimit(ctx, "submission.submit", { limit: 10, windowSec: 3600 });
    const selfCheck: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith("selfCheck.") && typeof value === "string" && value.length <= 40) selfCheck[key.slice("selfCheck.".length, 80)] = value;
    }
    return submitWork(ctx, { ...input, selfCheck });
  });
}
