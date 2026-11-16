// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import {
  contentDisposition,
  downloadHeaders,
  isInlineSafeType,
  isValidStorageKey,
  resolveKeyPath,
  safeFileName,
  servedContentType,
} from "@/server/storage/keys";
import {
  buildLocalSignedPath,
  verifyLocalSignedRequest,
  type LocalSignedParams,
} from "@/server/storage/signing";
import { DEFAULT_SIGNED_URL_SEC, MAX_SIGNED_URL_SEC, clampExpiry } from "@/server/storage/types";

const now = new Date("2026-11-16T12:00:00Z");
const exp = Math.floor(now.getTime() / 1000) + 300;

function parse(signedPath: string) {
  const url = new URL(signedPath, "http://localhost:3000");
  const key = url.pathname
    .replace(/^\/api\/files\//, "")
    .split("/")
    .map(decodeURIComponent)
    .join("/");
  return { key, query: url.searchParams };
}

describe("storage keys and path traversal", () => {
  it("accepts ordinary keys", () => {
    for (const key of ["a.png", "artefacts/3f0c/shot-1.png", "exports/2026/family_12.zip", "A/B/c.d.e"])
      expect(isValidStorageKey(key), key).toBe(true);
  });

  it.each([
    "../secret",
    "a/../../etc/passwd",
    "..",
    "a/..",
    "/etc/passwd",
    "a//b",
    "a/./b",
    "a\\..\\b",
    "a/.hidden",
    ".env",
    "a/b/",
    "",
    "a/%2e%2e/b",
    "a/b\u0000.png",
    "a b.png",
    "C:/windows",
    "a/..%2f..",
    "~/x",
  ])("refuses %j", (key) => {
    expect(isValidStorageKey(key)).toBe(false);
    expect(() => resolveKeyPath("/srv/storage", key)).toThrow(AppError);
  });

  it("refuses very long keys", () => {
    expect(isValidStorageKey(`a/${"b".repeat(600)}`)).toBe(false);
  });

  it("always resolves inside the root", () => {
    const root = "/srv/storage/private/objects";
    expect(resolveKeyPath(root, "artefacts/1/a.png")).toBe(path.join(root, "artefacts", "1", "a.png"));
    expect(resolveKeyPath(root, "a.png").startsWith(root + path.sep)).toBe(true);
  });
});

describe("how files are served", () => {
  it("shows only passive media in place", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "audio/mpeg",
      "application/pdf",
      "text/vtt",
      "text/plain",
      "Text/Plain; charset=utf-8",
    ]) {
      expect(isInlineSafeType(type), type).toBe(true);
    }
    for (const type of [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "text/xml",
      "application/javascript",
      "text/css",
      "application/zip",
      "text/csv",
      "",
      null,
      "nonsense",
    ]) {
      expect(isInlineSafeType(type), String(type)).toBe(false);
    }
  });

  it("never serves HTML or SVG as themselves", () => {
    expect(servedContentType("text/html; charset=utf-8")).toBe("application/octet-stream");
    expect(servedContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(servedContentType("text/plain")).toBe("text/plain; charset=utf-8");
    expect(servedContentType("image/png")).toBe("image/png");
  });

  it("forces a download, with nosniff, for anything that is not safe to show", () => {
    const headers = downloadHeaders({ key: "uploads/1/page.html", contentType: "text/html" });
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Disposition"]).toMatch(/^attachment; filename="page\.html"/);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toContain("sandbox");
    expect(headers["Cache-Control"]).toBe("private, no-store");
  });

  it("shows an image in place, unless a download name was asked for", () => {
    expect(downloadHeaders({ key: "a/shot.png", contentType: "image/png" })["Content-Disposition"]).toMatch(
      /^inline; filename="shot\.png"/,
    );
    const named = downloadHeaders({
      key: "a/shot.png",
      contentType: "image/png",
      downloadName: "My project.png",
    });
    expect(named["Content-Disposition"]).toMatch(/^attachment; filename="My project\.png"/);
    expect(named["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("makes file names safe for a header", () => {
    expect(safeFileName('../../evil"\r\nSet-Cookie: x=1.png')).toBe("evilSet-Cookie x=1.png");
    expect(safeFileName("")).toBe("download");
    expect(safeFileName("...hidden")).toBe("hidden");
    const header = contentDisposition("attachment", 'résumé "final".pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20final.pdf");
    expect(header).toContain('filename="r_sum_ final.pdf"');
  });

  it("defaults signed links to five minutes and caps them at an hour", () => {
    expect(DEFAULT_SIGNED_URL_SEC).toBe(300);
    expect(clampExpiry(undefined)).toBe(300);
    expect(clampExpiry(60)).toBe(60);
    expect(clampExpiry(999_999)).toBe(MAX_SIGNED_URL_SEC);
    expect(() => clampExpiry(0)).toThrow();
  });
});

describe("signed links for the local driver", () => {
  const get: LocalSignedParams = {
    op: "get",
    bucket: "private",
    key: "artefacts/1/shot one.png".replace(" ", "-"),
    exp,
  };
  const put: LocalSignedParams = {
    op: "put",
    bucket: "private",
    key: "uploads/1/a.png",
    exp,
    contentType: "image/png",
    maxBytes: 1024,
  };

  it("verifies a link it made", () => {
    const { key, query } = parse(buildLocalSignedPath({ ...get, name: "My work.png" }));
    const result = verifyLocalSignedRequest({ key, query, expectedOp: "get", now });
    expect(result).toEqual({ ok: true, params: { ...get, name: "My work.png" } });
  });

  it("verifies an upload link and returns its limits", () => {
    const { key, query } = parse(buildLocalSignedPath(put));
    expect(verifyLocalSignedRequest({ key, query, expectedOp: "put", now })).toEqual({
      ok: true,
      params: put,
    });
  });

  it("refuses a link once it has run out", () => {
    const { key, query } = parse(buildLocalSignedPath(get));
    expect(
      verifyLocalSignedRequest({ key, query, expectedOp: "get", now: new Date(exp * 1000 - 1) }),
    ).toMatchObject({ ok: true });
    expect(verifyLocalSignedRequest({ key, query, expectedOp: "get", now: new Date(exp * 1000) })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a link for a different file", () => {
    const { query } = parse(buildLocalSignedPath(get));
    expect(verifyLocalSignedRequest({ key: "artefacts/2/other.png", query, expectedOp: "get", now })).toEqual(
      { ok: false, reason: "bad_signature" },
    );
  });

  it.each([
    ["exp", String(exp + 86_400)],
    ["b", "public"],
    ["name", "other.exe"],
    ["op", "put"],
    ["sig", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  ])("refuses a link whose %s has been changed", (param, value) => {
    const { key, query } = parse(buildLocalSignedPath({ ...get, name: "a.png" }));
    query.set(param, value);
    expect(verifyLocalSignedRequest({ key, query, expectedOp: "get", now })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses an upload link whose size limit or type has been changed", () => {
    for (const [param, value] of [
      ["max", "999999999"],
      ["ct", "text/html"],
    ] as const) {
      const { key, query } = parse(buildLocalSignedPath(put));
      query.set(param, value);
      expect(verifyLocalSignedRequest({ key, query, expectedOp: "put", now })).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    }
  });

  it("does not let a download link upload, or an upload link download", () => {
    const download = parse(buildLocalSignedPath(get));
    expect(verifyLocalSignedRequest({ ...download, expectedOp: "put", now })).toEqual({
      ok: false,
      reason: "wrong_operation",
    });
    const upload = parse(buildLocalSignedPath(put));
    expect(verifyLocalSignedRequest({ ...upload, expectedOp: "get", now })).toEqual({
      ok: false,
      reason: "wrong_operation",
    });
  });

  it("refuses requests with missing or malformed parts, and traversal in the path", () => {
    const { key, query } = parse(buildLocalSignedPath(get));
    const without = new URLSearchParams(query);
    without.delete("sig");
    expect(verifyLocalSignedRequest({ key, query: without, expectedOp: "get", now })).toEqual({
      ok: false,
      reason: "malformed",
    });
    const badExp = new URLSearchParams(query);
    badExp.set("exp", "soon");
    expect(verifyLocalSignedRequest({ key, query: badExp, expectedOp: "get", now })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyLocalSignedRequest({ key: "../../etc/passwd", query, expectedOp: "get", now })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyLocalSignedRequest({ key, query: new URLSearchParams(), expectedOp: "get", now })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
