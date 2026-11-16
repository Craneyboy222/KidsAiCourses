import { fileTypeFromBuffer } from "file-type";
import { checkUrlShape } from "@/server/net/safe-fetch";
import { SECRET_QUERY_PARAM, isUrlAllowedForTool } from "./tools";

/**
 * The automated checks on evidence (spec 3.4, decisions D3 and D4). Everything here is a pure
 * function of its input: no database, no storage, no clock. `submission.ts` does the reading and
 * writing around it.
 */

// ───────────────────────────── File types and sizes ─────────────────────────────

export const UPLOAD_KINDS = ["screenshot", "file", "video"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export const isUploadKind = (kind: string): kind is UploadKind => (UPLOAD_KINDS as readonly string[]).includes(kind);

type TypeRule = { mime: string; ext: string; label: string };

const IMAGE_TYPES: TypeRule[] = [
  { mime: "image/png", ext: "png", label: "PNG" },
  { mime: "image/jpeg", ext: "jpg", label: "JPG" },
  { mime: "image/webp", ext: "webp", label: "WebP" },
];
const VIDEO_TYPES: TypeRule[] = [
  { mime: "video/mp4", ext: "mp4", label: "MP4" },
  { mime: "video/webm", ext: "webm", label: "WebM" },
  { mime: "video/quicktime", ext: "mov", label: "MOV" },
];
/** Types with a recognisable signature. */
const BINARY_FILE_TYPES: TypeRule[] = [
  { mime: "application/pdf", ext: "pdf", label: "PDF" },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx", label: "Word" },
  { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx", label: "PowerPoint" },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", label: "Excel" },
  { mime: "audio/mpeg", ext: "mp3", label: "MP3" },
  { mime: "audio/wav", ext: "wav", label: "WAV" },
  { mime: "audio/mp4", ext: "m4a", label: "M4A" },
  { mime: "audio/ogg", ext: "ogg", label: "OGG" },
];
/** Plain text has no signature: the bytes must read as text and must not be a web page. */
const TEXT_FILE_TYPES: TypeRule[] = [
  { mime: "text/plain", ext: "txt", label: "text" },
  { mime: "text/markdown", ext: "md", label: "Markdown" },
  { mime: "text/csv", ext: "csv", label: "CSV" },
  { mime: "application/json", ext: "json", label: "JSON" },
];

export const ALLOWED_UPLOAD_TYPES: Record<UploadKind, readonly TypeRule[]> = {
  screenshot: IMAGE_TYPES,
  video: VIDEO_TYPES,
  file: [...BINARY_FILE_TYPES, ...TEXT_FILE_TYPES],
};

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "text/x-markdown": "text/markdown",
  "application/csv": "text/csv",
};

/** Lower-case media type without parameters, with the common other spellings folded together. */
export function canonicalMime(value: string | null | undefined): string {
  const base = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_ALIASES[base] ?? base;
}

export const findTypeRule = (kind: UploadKind, mime: string): TypeRule | undefined => ALLOWED_UPLOAD_TYPES[kind].find((rule) => rule.mime === canonicalMime(mime));

export const acceptedLabels = (kind: UploadKind): string => ALLOWED_UPLOAD_TYPES[kind].map((rule) => rule.label).join(", ");

export type UploadLimitsMb = { screenshot: number; file: number; video: number };

export const maxBytesFor = (kind: UploadKind, limits: UploadLimitsMb): number => Math.floor(limits[kind] * 1024 * 1024);

const WRONG_TYPE: Record<UploadKind, string> = {
  screenshot: "Screenshots need to be PNG, JPG or WebP images. Take a new screenshot and try again.",
  video: "Videos need to be MP4, WebM or MOV files. Export it again as an MP4 and try that.",
  file: "We can't accept that kind of file here. Try a PDF, a Word document, a text file or an audio file.",
};

export type DeclaredCheck = { ok: true; mime: string; maxBytes: number } | { ok: false; message: string };

/** The check made before a signed upload link is handed out, from what the browser says about the file. */
export function checkDeclaredUpload(input: { kind: UploadKind; contentType: string; sizeBytes: number }, limits: UploadLimitsMb): DeclaredCheck {
  const rule = findTypeRule(input.kind, input.contentType);
  if (!rule) return { ok: false, message: WRONG_TYPE[input.kind] };
  const maxBytes = maxBytesFor(input.kind, limits);
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, message: "That file is empty. Check it opens on your device, then try again." };
  if (input.sizeBytes > maxBytes) {
    return { ok: false, message: `That file is too big. The limit here is ${limits[input.kind]} MB. Try a smaller file${input.kind === "video" ? " or a shorter clip" : ""}.` };
  }
  return { ok: true, mime: rule.mime, maxBytes };
}

function looksLikeText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const MARKUP_START = /^﻿?\s*<(?:!doctype|html|svg|\?xml|script|head|body|iframe)\b/i;

export type InspectedUpload =
  | { ok: true; mime: string; ext: string; isMedia: boolean; bytes: Buffer }
  | { ok: false; reason: "empty" | "too_large" | "type_not_allowed" | "type_mismatch" | "unreadable"; message: string };

/**
 * The check made on the bytes that actually arrived. The declared type is only a claim: the real
 * type is read from the file's own signature, must be allowed for this kind of evidence, and must
 * be the type that was declared. Images come back with their metadata (EXIF, GPS position, device
 * details, comments) removed; videos with their metadata boxes blanked.
 */
export async function inspectUpload(bytes: Buffer, input: { kind: UploadKind; declaredType: string; maxBytes: number }): Promise<InspectedUpload> {
  if (bytes.length === 0) return { ok: false, reason: "empty", message: "That file is empty. Check it opens on your device, then try again." };
  if (bytes.length > input.maxBytes) return { ok: false, reason: "too_large", message: "That file is too big. Try a smaller file or a shorter clip." };

  const declared = canonicalMime(input.declaredType);
  const detected = await fileTypeFromBuffer(bytes);
  const real = detected ? canonicalMime(detected.mime) : null;

  if (real === null) {
    // No signature. Only plain-text evidence may be like that, and only when it really is text.
    const rule = input.kind === "file" ? TEXT_FILE_TYPES.find((entry) => entry.mime === declared) : undefined;
    if (!rule || !looksLikeText(bytes) || MARKUP_START.test(bytes.subarray(0, 512).toString("utf8"))) {
      return { ok: false, reason: "type_not_allowed", message: WRONG_TYPE[input.kind] };
    }
    return { ok: true, mime: rule.mime, ext: rule.ext, isMedia: false, bytes };
  }

  const rule = findTypeRule(input.kind, real);
  if (!rule || TEXT_FILE_TYPES.includes(rule)) return { ok: false, reason: "type_not_allowed", message: WRONG_TYPE[input.kind] };
  if (rule.mime !== declared) {
    return { ok: false, reason: "type_mismatch", message: "That file isn't the type its name says it is. Save or export it again, then upload the new copy." };
  }

  if (input.kind === "screenshot") {
    const cleaned = stripImageMetadata(bytes, rule.mime);
    if (!cleaned) return { ok: false, reason: "unreadable", message: "We couldn't read that image. Take a new screenshot and try again." };
    return { ok: true, mime: rule.mime, ext: rule.ext, isMedia: true, bytes: cleaned };
  }
  if (input.kind === "video") {
    return { ok: true, mime: rule.mime, ext: rule.ext, isMedia: true, bytes: rule.mime === "video/webm" ? bytes : blankVideoMetadata(bytes) };
  }
  return { ok: true, mime: rule.mime, ext: rule.ext, isMedia: false, bytes };
}

// ───────────────────────────── Metadata removal ─────────────────────────────

function stripJpeg(bytes: Buffer): Buffer | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const out: Buffer[] = [bytes.subarray(0, 2)];
  let pos = 2;
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1] ?? 0;
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(out); // anything after the end marker (an appended clip, say) is dropped
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(bytes.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(pos + 2);
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isIcc = marker === 0xe2 && bytes.subarray(pos + 4, pos + 16).toString("latin1") === "ICC_PROFILE\0";
    // Kept: JFIF (APP0), a colour profile, Adobe's colour transform (APP14) and everything the decoder needs.
    const keep = marker !== 0xfe && (!isApp || marker === 0xe0 || marker === 0xee || isIcc);
    if (keep) out.push(bytes.subarray(pos, end));
    pos = end;
    if (marker === 0xda) {
      // Entropy-coded data: runs to the next real marker. 0xFF00 is a stuffed byte, 0xFFD0–D7 are restarts.
      const start = pos;
      while (pos < bytes.length) {
        if (bytes[pos] === 0xff) {
          const next = bytes[pos + 1];
          if (next === undefined) return null;
          if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break;
          pos += next === 0xff ? 1 : 2;
        } else {
          pos += 1;
        }
      }
      out.push(bytes.subarray(start, pos));
    }
  }
  return null; // ran out before the end marker
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROPPED = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(bytes: Buffer): Buffer | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const out: Buffer[] = [PNG_SIGNATURE];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.subarray(pos + 4, pos + 8).toString("latin1");
    const end = pos + 12 + length;
    if (end > bytes.length) return null;
    if (!PNG_DROPPED.has(type)) out.push(bytes.subarray(pos, end));
    pos = end;
    if (type === "IEND") return Buffer.concat(out);
  }
  return null;
}

function stripWebp(bytes: Buffer): Buffer | null {
  if (bytes.length < 12 || bytes.subarray(0, 4).toString("latin1") !== "RIFF" || bytes.subarray(8, 12).toString("latin1") !== "WEBP") return null;
  const chunks: Buffer[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const type = bytes.subarray(pos, pos + 4).toString("latin1");
    const size = bytes.readUInt32LE(pos + 4);
    const end = pos + 8 + size + (size % 2);
    if (pos + 8 + size > bytes.length) return null;
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = Buffer.from(bytes.subarray(pos, Math.min(end, bytes.length)));
      // The extended header says which optional chunks follow: clear the EXIF (0x08) and XMP (0x04) flags.
      if (type === "VP8X" && chunk.length > 8) chunk[8] = (chunk[8] ?? 0) & ~0x0c;
      chunks.push(chunk.length % 2 === 1 ? Buffer.concat([chunk, Buffer.from([0])]) : chunk);
    }
    pos = end;
  }
  if (chunks.length === 0) return null;
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}

/** The same picture without EXIF, GPS, XMP, IPTC, comments or timestamps. Null when the file cannot be read. */
export function stripImageMetadata(bytes: Buffer, mime: string): Buffer | null {
  switch (canonicalMime(mime)) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
    default:
      return null;
  }
}

const VIDEO_METADATA_BOXES = new Set(["udta", "meta", "uuid"]);
const VIDEO_CONTAINERS = new Set(["moov", "trak"]);

/**
 * Blanks the metadata boxes of an MP4 or MOV (where a phone writes the place it was filmed) by
 * renaming them to `free`, which every player skips. Sizes and offsets do not change, so the video
 * itself is untouched. A file that cannot be walked is returned as it came: it still waits for a
 * person, like every video.
 */
export function blankVideoMetadata(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  const walk = (start: number, end: number, depth: number): void => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = copy.readUInt32BE(pos);
      const type = copy.subarray(pos + 4, pos + 8).toString("latin1");
      let header = 8;
      if (size === 1) {
        if (pos + 16 > end) return;
        const large = copy.readBigUInt64BE(pos + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) return;
        size = Number(large);
        header = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < header || pos + size > end) return;
      if (VIDEO_METADATA_BOXES.has(type)) copy.write("free", pos + 4, "latin1");
      else if (VIDEO_CONTAINERS.has(type) && depth < 4) walk(pos + header, pos + size, depth + 1);
      pos += size;
    }
  };
  walk(0, copy.length, 0);
  return copy;
}

// ───────────────────────────── Links ─────────────────────────────

export const MAX_LINK_LENGTH = 2048;

export type LinkTool = { slug: string; name: string; allowedUrlPrefixes: string[] };

export type LinkShapeCheck = { ok: true; url: string } | { ok: false; message: string };

/**
 * The rules a link must meet before any network lookup: a full https address on the public
 * internet, no sign-in details, no unusual port, and nothing in the query that looks like a secret.
 * The caller then runs `checkPublicUrl` (DNS) on the result. We never fetch the page.
 */
export function checkEvidenceLinkShape(input: string): LinkShapeCheck {
  const raw = input.trim();
  if (raw.length === 0) return { ok: false, message: "Paste the link to your project first." };
  if (raw.length > MAX_LINK_LENGTH || /[\s\\\u0000-\u001f\u007f]/.test(raw)) {
    return { ok: false, message: "That doesn't look like a web address. Copy the share link from your project and paste it here." };
  }
  const shape = checkUrlShape(raw);
  if (!shape.ok) return { ok: false, message: shape.reason };
  for (const name of shape.url.searchParams.keys()) {
    if (SECRET_QUERY_PARAM.test(name)) {
      return { ok: false, message: "That link has a password or sign-in code inside it, so we can't take it. Use the Share button in your project and copy that link instead." };
    }
  }
  return { ok: true, url: shape.url.href };
}

/** The first tool whose Register allow-list this link sits under, or null. */
export function matchLinkToTool<T extends LinkTool>(url: string, tools: readonly T[]): T | null {
  return tools.find((tool) => isUrlAllowedForTool(tool, url)) ?? null;
}

// ───────────────────────────── Accept, hold or sample ─────────────────────────────

/** True when this clean submission is picked for the human sample. `roll` is a number in [0, 1). */
export function isSampled(sampleRate: number, roll: number): boolean {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  return roll < sampleRate;
}

export type CheckedItem = {
  kind: "link" | UploadKind;
  /** For uploads: the people-screening result. */
  peopleCheck: "not_applicable" | "pending" | "clear" | "people_suspected" | "needs_human" | "declared_no_people";
  /** For links: whether the address sits under a Register tool this course uses. */
  onRegister?: boolean;
};

export type HoldReason = "auto_accept_off" | "people_check_needed" | "link_off_register" | "text_flagged" | "sampled";

export type SubmissionOutcome =
  | { decision: "accept"; sampled: false; reasons: [] }
  | { decision: "hold"; sampled: boolean; reasons: HoldReason[]; source: "auto" | "sample" | "submission"; severity: "critical" | "high" | "normal" };

/**
 * What happens to a submission whose files and links have each passed their own checks.
 *
 * Accepted without a person only when ALL of these hold: the auto-accept setting is on; every
 * image and video file was cleared by an automatic detector (never the case with the `manual`
 * detector, decision D3); every link is to a tool on the Register that this course uses; the title
 * and note raised nothing; and it was not picked for the random sample. Otherwise it is HELD until
 * a person decides (decision D4: a sampled submission is not accepted, and no certificate is
 * issued, until it has been reviewed).
 */
export function decideSubmission(input: { autoAccept: boolean; sampleRate: number; roll: number; items: readonly CheckedItem[]; textSeverity: "critical" | "high" | null }): SubmissionOutcome {
  const reasons: HoldReason[] = [];
  if (input.textSeverity) reasons.push("text_flagged");
  const mediaUnchecked = input.items.some((item) => (item.kind === "screenshot" || item.kind === "video") && item.peopleCheck !== "clear");
  const fileUnchecked = input.items.some((item) => item.kind === "file" && item.peopleCheck !== "not_applicable" && item.peopleCheck !== "clear");
  if (mediaUnchecked || fileUnchecked) reasons.push("people_check_needed");
  if (input.items.some((item) => item.kind === "link" && item.onRegister !== true)) reasons.push("link_off_register");
  if (!input.autoAccept) reasons.push("auto_accept_off");

  if (reasons.length > 0) {
    const flagged = reasons.some((reason) => reason !== "auto_accept_off");
    return { decision: "hold", sampled: false, reasons, source: flagged ? "auto" : "submission", severity: input.textSeverity ?? "normal" };
  }
  if (isSampled(input.sampleRate, input.roll)) return { decision: "hold", sampled: true, reasons: ["sampled"], source: "sample", severity: "normal" };
  return { decision: "accept", sampled: false, reasons: [] };
}
