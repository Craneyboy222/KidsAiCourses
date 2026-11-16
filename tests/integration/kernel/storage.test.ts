import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/files/[...key]/route";
import { resetEnvCache } from "@/env";
import { createLocalStorage, getStorage, setStorage, verifyUpload, type Storage } from "@/server/storage";

/** No database here: the local driver is files on disk. It lives with the integration tests because it touches the file system. */
let root: string;
let storage: Storage;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "platform-storage-"));
});
beforeEach(() => {
  storage = createLocalStorage("private", { rootDir: root, baseUrl: "http://localhost:3000" });
  setStorage("private", storage);
});
afterEach(() => {
  setStorage("private", undefined);
  vi.unstubAllEnvs();
  resetEnvCache();
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

let counter = 0;
const uniqueKey = (name: string) => `tests/${Date.now()}-${(counter += 1)}/${name}`;

/** Calls the route handler the way Next.js would for a signed URL. */
function call(handler: typeof GET, url: string, init: RequestInit = {}) {
  const parsed = new URL(url);
  const key = parsed.pathname
    .replace(/^\/api\/files\//, "")
    .split("/")
    .map(decodeURIComponent);
  return handler(new Request(url, init), { params: Promise.resolve({ key }) });
}

describe("local storage driver", () => {
  it("round-trips an object: put, exists, stat, get, delete", async () => {
    const key = uniqueKey("shot.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.stat(key)).toBeNull();

    await storage.put(key, bytes, { contentType: "image/png" });
    expect(await storage.exists(key)).toBe(true);
    expect(await storage.stat(key)).toEqual({ size: 8, contentType: "image/png" });
    const got = await storage.get(key);
    expect(got?.body.equals(bytes)).toBe(true);
    expect(got).toMatchObject({ size: 8, contentType: "image/png" });

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await storage.delete(key); // deleting again is not an error
  });

  it("stores strings and overwrites on a second put", async () => {
    const key = uniqueKey("notes.txt");
    await storage.put(key, "first", { contentType: "text/plain; charset=utf-8" });
    await storage.put(key, "second version", { contentType: "text/plain" });
    const got = await storage.get(key);
    expect(got?.body.toString("utf8")).toBe("second version");
    expect(got?.contentType).toBe("text/plain");
  });

  it("refuses path traversal on every operation and writes nothing outside its folder", async () => {
    const before = await readdir(path.dirname(root));
    for (const key of ["../escape.txt", "a/../../escape.txt", "/etc/passwd", "a/..", ".env", "a\\b"]) {
      await expect(storage.put(key, "x", { contentType: "text/plain" })).rejects.toMatchObject({
        code: "invalid_input",
      });
      await expect(storage.get(key)).rejects.toMatchObject({ code: "invalid_input" });
      await expect(storage.delete(key)).rejects.toMatchObject({ code: "invalid_input" });
      await expect(storage.exists(key)).rejects.toMatchObject({ code: "invalid_input" });
      await expect(storage.signedDownloadUrl(key)).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        storage.signedUploadUrl(key, { contentType: "text/plain", maxBytes: 10 }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(await readdir(path.dirname(root))).toEqual(before);
  });

  it("keeps the two buckets apart", async () => {
    const pub = createLocalStorage("public", { rootDir: root });
    const key = uniqueKey("asset.png");
    await pub.put(key, "public", { contentType: "image/png" });
    expect(await storage.exists(key)).toBe(false);
    expect(await pub.exists(key)).toBe(true);
  });

  it("is what getStorage() gives by default in tests", () => {
    setStorage("private", undefined);
    expect(getStorage().driver).toBe("local");
    expect(getStorage("public").driver).toBe("local");
  });
});

describe("signed download through /api/files", () => {
  it("serves an image in place with safe headers", async () => {
    const key = uniqueKey("shot.png");
    await storage.put(key, Buffer.from("png-bytes"), { contentType: "image/png" });
    const url = await storage.signedDownloadUrl(key);
    expect(url).toMatch(/^http:\/\/localhost:3000\/api\/files\/tests\//);

    const response = await call(GET, url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename="shot\.png"/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-length")).toBe("9");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("png-bytes");
  });

  it("never serves HTML or SVG as a page: they are forced downloads with a generic type", async () => {
    for (const [name, type, body] of [
      ["page.html", "text/html", "<script>alert(document.cookie)</script>"],
      ["logo.svg", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
      ["data.csv", "text/csv", "a,b"],
    ] as const) {
      const key = uniqueKey(name);
      await storage.put(key, body, { contentType: type });
      const response = await call(GET, await storage.signedDownloadUrl(key));
      expect(response.status, name).toBe(200);
      expect(response.headers.get("content-type"), name).toBe("application/octet-stream");
      expect(response.headers.get("content-disposition"), name).toMatch(
        new RegExp(`^attachment; filename="${name.replace(".", "\\.")}"`),
      );
      expect(response.headers.get("x-content-type-options"), name).toBe("nosniff");
      expect(response.headers.get("content-security-policy"), name).toContain("sandbox");
    }
  });

  it("uses the download name when one was signed", async () => {
    const key = uniqueKey("export.zip");
    await storage.put(key, "zip", { contentType: "application/zip" });
    const response = await call(
      GET,
      await storage.signedDownloadUrl(key, { downloadName: "My family data.zip" }),
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="My family data\.zip"/,
    );
  });

  it("links last five minutes by default and are refused afterwards", async () => {
    const key = uniqueKey("a.txt");
    await storage.put(key, "hello", { contentType: "text/plain" });
    const justUnderFiveMinutesAgo = new Date(Date.now() - 299_000);
    expect(
      (await call(GET, await storage.signedDownloadUrl(key, { now: justUnderFiveMinutesAgo }))).status,
    ).toBe(200);
    const fiveMinutesAgo = new Date(Date.now() - 301_000);
    const expired = await call(GET, await storage.signedDownloadUrl(key, { now: fiveMinutesAgo }));
    expect(expired.status).toBe(403);
    expect(await expired.json()).toMatchObject({
      error: { code: "forbidden", message: expect.stringContaining("run out") },
    });
  });

  it("refuses a tampered or unsigned link, and a link for another file", async () => {
    const key = uniqueKey("private.txt");
    const other = uniqueKey("other.txt");
    await storage.put(key, "secret", { contentType: "text/plain" });
    await storage.put(other, "other secret", { contentType: "text/plain" });
    const url = new URL(await storage.signedDownloadUrl(key));

    const unsigned = new URL(url);
    unsigned.searchParams.delete("sig");
    expect((await call(GET, unsigned.toString())).status).toBe(403);

    const longer = new URL(url);
    longer.searchParams.set("exp", String(Number(longer.searchParams.get("exp")) + 86_400));
    expect((await call(GET, longer.toString())).status).toBe(403);

    const swapped = new URL(url);
    swapped.pathname = `/api/files/${other}`;
    const response = await call(GET, swapped.toString());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("other secret");

    const traversal = await GET(new Request(url), {
      params: Promise.resolve({ key: ["..", "..", "etc", "passwd"] }),
    });
    expect(traversal.status).toBe(403);
  });

  it("answers 404 for a valid link to a file that has gone", async () => {
    const key = uniqueKey("gone.txt");
    expect((await call(GET, await storage.signedDownloadUrl(key))).status).toBe(404);
  });

  it("supports range requests, for video and audio players", async () => {
    const key = uniqueKey("clip.mp4");
    await storage.put(key, "0123456789", { contentType: "video/mp4" });
    const url = await storage.signedDownloadUrl(key);
    const part = await call(GET, url, { headers: { Range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");
    const tail = await call(GET, url, { headers: { Range: "bytes=-3" } });
    expect(await tail.text()).toBe("789");
    expect((await call(GET, url, { headers: { Range: "bytes=50-60" } })).status).toBe(200);
  });

  it("is switched off when storage is not local", async () => {
    const key = uniqueKey("a.txt");
    await storage.put(key, "hello", { contentType: "text/plain" });
    const url = await storage.signedDownloadUrl(key);
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    resetEnvCache();
    expect((await call(GET, url)).status).toBe(404);
  });
});

describe("signed upload through /api/files", () => {
  const put = (url: string, body: BodyInit, headers: Record<string, string>) =>
    call(PUT, url, { method: "PUT", body, headers });

  it("accepts the upload it was signed for, once", async () => {
    const key = uniqueKey("upload.png");
    const signed = await storage.signedUploadUrl(key, { contentType: "image/png", maxBytes: 1024 });
    expect(signed).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/png" } });
    expect(signed.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);

    const response = await put(signed.url, "png-bytes", signed.headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, size: 9 });
    expect((await storage.get(key))?.body.toString()).toBe("png-bytes");
    expect(await verifyUpload(key, { maxBytes: 1024 }, storage)).toEqual({
      size: 9,
      contentType: "image/png",
    });

    // The link cannot be used again to replace the file.
    const again = await put(signed.url, "replaced!", signed.headers);
    expect(again.status).toBe(409);
    expect((await storage.get(key))?.body.toString()).toBe("png-bytes");
  });

  it("refuses a body over the signed size, whatever Content-Length says", async () => {
    const key = uniqueKey("big.png");
    const signed = await storage.signedUploadUrl(key, { contentType: "image/png", maxBytes: 10 });
    const honest = await put(signed.url, "x".repeat(11), { ...signed.headers, "Content-Length": "11" });
    expect(honest.status).toBe(413);
    expect(await honest.json()).toMatchObject({ error: { code: "upload_rejected" } });
    // A streamed body with no declared length is cut off as well.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i += 1) controller.enqueue(new TextEncoder().encode("xxxxx"));
        controller.close();
      },
    });
    const streamed = await call(PUT, signed.url, {
      method: "PUT",
      body: stream,
      headers: signed.headers,
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(await storage.exists(key)).toBe(false);
    // Exactly at the limit is fine.
    expect((await put(signed.url, "x".repeat(10), signed.headers)).status).toBe(200);
  });

  it("refuses a different content type, an empty body, a download link and an expired link", async () => {
    const key = uniqueKey("doc.png");
    const signed = await storage.signedUploadUrl(key, { contentType: "image/png", maxBytes: 100 });
    expect((await put(signed.url, "<html>", { "Content-Type": "text/html" })).status).toBe(415);
    expect((await put(signed.url, "", signed.headers)).status).toBe(422);

    const download = await storage.signedDownloadUrl(key);
    expect((await put(download, "data", signed.headers)).status).toBe(403);
    expect((await call(GET, signed.url)).status).toBe(403);

    const old = await storage.signedUploadUrl(key, {
      contentType: "image/png",
      maxBytes: 100,
      now: new Date(Date.now() - 400_000),
    });
    expect((await put(old.url, "data", old.headers)).status).toBe(403);
    expect(await storage.exists(key)).toBe(false);
  });

  it("verifyUpload deletes a file that is too big and reports a missing one", async () => {
    const key = uniqueKey("huge.bin");
    await storage.put(key, "x".repeat(50), { contentType: "application/octet-stream" });
    await expect(verifyUpload(key, { maxBytes: 10 }, storage)).rejects.toMatchObject({
      code: "upload_rejected",
    });
    expect(await storage.exists(key)).toBe(false);
    await expect(verifyUpload(key, { maxBytes: 10 }, storage)).rejects.toMatchObject({
      code: "upload_rejected",
    });
  });
});
