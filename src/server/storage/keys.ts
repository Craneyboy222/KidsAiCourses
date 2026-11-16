import path from "node:path";
import { AppError } from "@/server/errors";

/**
 * Rules for object keys and for how a stored file may be sent to a browser. Pure functions.
 */

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_KEY_LENGTH = 512;

/**
 * A key is `segment/segment/...`, each segment starting with a letter or digit and using only
 * letters, digits, dot, dash and underscore. That rules out `..`, absolute paths, backslashes,
 * hidden files, empty segments, encoded tricks and control characters in one go.
 */
export function isValidStorageKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  return key.split("/").every((segment) => SEGMENT.test(segment) && !segment.includes(".."));
}

export function assertStorageKey(key: string): string {
  if (!isValidStorageKey(key)) {
    throw new AppError(
      "invalid_input",
      "That file name can't be used. Try renaming the file using only letters, numbers, dashes and dots.",
      {
        detail: { reason: "invalid_storage_key" },
      },
    );
  }
  return key;
}

/**
 * The file path for a key inside `root`. Validates the key, then checks the resolved path is
 * still inside the root as a second line of defence.
 */
export function resolveKeyPath(root: string, key: string): string {
  assertStorageKey(key);
  const base = path.resolve(root);
  const full = path.resolve(base, ...key.split("/"));
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new AppError("invalid_input", "That file name can't be used.", {
      detail: { reason: "path_outside_storage_root" },
    });
  }
  if (full === base)
    throw new AppError("invalid_input", "That file name can't be used.", {
      detail: { reason: "empty_storage_key" },
    });
  return full;
}

/** Lower-case media type without parameters: `Text/HTML; charset=utf-8` → `text/html`. */
export function baseContentType(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

const INLINE_IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/**
 * May a browser display this type in place? Only passive media: raster images, video, audio,
 * PDF, WebVTT captions and plain text. Everything else, including HTML, SVG (which can carry
 * script), XML and anything unknown, is only ever offered as a download.
 */
export function isInlineSafeType(contentType: string | null | undefined): boolean {
  const type = baseContentType(contentType);
  if (INLINE_IMAGE.has(type)) return true;
  if (type.startsWith("video/") || type.startsWith("audio/")) return true;
  return type === "application/pdf" || type === "text/vtt" || type === "text/plain";
}

/** The `Content-Type` to serve: the stored one when it is safe to show, otherwise a generic download type. */
export function servedContentType(contentType: string | null | undefined): string {
  const type = baseContentType(contentType);
  if (!isInlineSafeType(type)) return "application/octet-stream";
  return type.startsWith("text/") ? `${type}; charset=utf-8` : type;
}

/** A file name that is safe inside a header: no path, quotes, control characters or leading dots. */
export function safeFileName(name: string | null | undefined, fallback = "download"): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f"<>:|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 150);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** `Content-Disposition` with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const name = safeFileName(fileName);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * How to send a stored file to a browser. A requested download name always means "save it";
 * otherwise only inline-safe types are shown in place.
 */
export function downloadHeaders(input: {
  key: string;
  contentType: string | null | undefined;
  downloadName?: string | null;
}): Record<string, string> {
  const inline = !input.downloadName && isInlineSafeType(input.contentType);
  const name = input.downloadName ?? input.key.split("/").pop() ?? "download";
  return {
    "Content-Type": servedContentType(input.contentType),
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", name),
    "X-Content-Type-Options": "nosniff",
    // Belt and braces for downloads: if a browser ever did render one, it could run nothing.
    // Not sent for media and PDFs shown in place, because a sandbox stops browsers' own viewers.
    ...(inline ? {} : { "Content-Security-Policy": "default-src 'none'; sandbox" }),
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
