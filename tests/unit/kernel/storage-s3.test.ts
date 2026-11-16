// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/env";
import type { Storage } from "@/server/storage/types";

/**
 * The S3 driver's signed links are worked out locally (no network), so they can be checked here.
 * Reading and writing objects needs a real bucket and is not covered by automated tests.
 */
let storage: Storage;

beforeAll(async () => {
  vi.stubEnv("STORAGE_PROVIDER", "s3");
  vi.stubEnv("STORAGE_S3_REGION", "eu-west-2");
  vi.stubEnv("STORAGE_S3_ACCESS_KEY_ID", "AKIAEXAMPLEEXAMPLE00");
  vi.stubEnv("STORAGE_S3_SECRET_ACCESS_KEY", "example-secret-access-key-not-real-000000");
  vi.stubEnv("STORAGE_BUCKET_PRIVATE", "platform-private");
  resetEnvCache();
  const { createS3Storage } = await import("@/server/storage/s3");
  storage = createS3Storage("private");
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("S3 signed links", () => {
  it("signs a download for five minutes by default, in the London region", async () => {
    const url = new URL(await storage.signedDownloadUrl("artefacts/1/shot.png"));
    expect(url.hostname).toBe("platform-private.s3.eu-west-2.amazonaws.com");
    expect(url.pathname).toBe("/artefacts/1/shot.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/eu-west-2/s3/aws4_request");
    expect(url.searchParams.has("response-content-disposition")).toBe(false);
  });

  it("caps the lifetime at an hour and adds the download name", async () => {
    const url = new URL(
      await storage.signedDownloadUrl("exports/1/data.zip", {
        expiresInSec: 86_400,
        downloadName: "My family data.zip",
      }),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("response-content-disposition")).toMatch(
      /^attachment; filename="My family data\.zip"/,
    );
  });

  it("signs an upload whose content type the browser must send", async () => {
    const signed = await storage.signedUploadUrl("uploads/1/shot.png", {
      contentType: "image/png",
      maxBytes: 5_000_000,
    });
    expect(signed.method).toBe("PUT");
    expect(signed.headers).toEqual({ "Content-Type": "image/png" });
    const url = new URL(signed.url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("stores anything a browser must not display as a download with a generic type", async () => {
    const signed = await storage.signedUploadUrl("uploads/1/page.html", {
      contentType: "text/html",
      maxBytes: 1000,
    });
    expect(signed.headers["Content-Type"]).toBe("application/octet-stream");
    expect(signed.headers["Content-Disposition"]).toMatch(/^attachment; filename="page\.html"/);
    const signedHeaders = new URL(signed.url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signedHeaders).toContain("content-type");
    expect(signedHeaders).toContain("content-disposition");
  });

  it("refuses path traversal before anything is signed", async () => {
    await expect(storage.signedDownloadUrl("../other-bucket/secret")).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      storage.signedUploadUrl("a/../../b", { contentType: "image/png", maxBytes: 1 }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(storage.get("/etc/passwd")).rejects.toMatchObject({ code: "invalid_input" });
  });
});
