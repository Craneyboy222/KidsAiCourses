/** Wording shared by the evidence form, the preview and the portfolio. Safe for client and server. */
export type EvidenceKind = "link" | "screenshot" | "file" | "video";

export const KIND_LABELS: Record<EvidenceKind, { name: string; add: string; description: string }> = {
  link: { name: "Link", add: "Add a link", description: "A share or view link to the project (we never open it for them, and it is never shown as a live page)" },
  screenshot: { name: "Screenshot", add: "Upload a screenshot", description: "A screenshot (PNG, JPG or WebP)" },
  file: { name: "File", add: "Upload a file", description: "A document or audio file (PDF, Word, text, MP3 and similar)" },
  video: { name: "Video", add: "Upload a video", description: "A video (MP4, WebM or MOV)" },
};

export const NO_PEOPLE_RULE = "Don't send photos or videos of real people, including you. Use the sample image, a cartoon, an object or something you generated.";

export const STATE_LABELS = {
  ready: "Ready to send",
  awaiting_review: "Being checked",
  accepted: "Accepted",
  rejected: "Not accepted",
} as const;

export const STATUS_LABELS = {
  draft: "Not handed in yet",
  awaiting_review: "Awaiting review",
  accepted: "Accepted",
  needs_changes: "Needs a change",
} as const;

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const BY_EXTENSION: Record<string, string> = { md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json", pdf: "application/pdf", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", mov: "video/quicktime", mp4: "video/mp4", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** The type to declare for a file when the browser gives none (it often doesn't for `.md` or `.csv`). The server checks the real bytes either way. */
export function declaredTypeFor(file: { type: string; name: string }): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? "application/octet-stream";
}
