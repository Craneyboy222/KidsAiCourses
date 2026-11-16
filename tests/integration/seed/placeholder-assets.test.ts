import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ManifestAsset } from "@/content/asset-schema";
import { createLocalStorage, type Storage } from "@/server/storage";
import { hasFfmpeg, makePlaceholderAssets, markerKeyFor } from "../../../scripts/make-placeholder-assets";

/**
 * The generator against a throw-away local storage folder. The rule under test: a placeholder is
 * only ever written where nothing is stored, or over a placeholder this script made itself and
 * nobody has touched. A real asset is never overwritten.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const asset = (id: string, kind: ManifestAsset["kind"], storageKey: string, placeholder = true): ManifestAsset => ({ id, kind, storageKey, licence: "owned", ...(placeholder ? { placeholder: true as const } : {}) });

const POSTER = asset("img-demo-poster", "image", "courses/demo/trailer-poster.png");
const SAMPLE = asset("img-demo-sample", "image", "courses/demo/sample-image.png");
const CAPTIONS = asset("vtt-demo", "captions_vtt", "courses/demo/trailer.en.vtt");
const TRANSCRIPT = asset("tx-demo", "transcript_md", "courses/demo/trailer.transcript.md");
const TEMPLATE = asset("tpl-demo", "template_zip", "courses/demo/template.zip");
const FONT = asset("font-demo", "font", "courses/demo/brand.woff2");
const REAL = asset("img-real", "image", "courses/demo/real-photo-free-illustration.png", false);
const VIDEO = asset("vid-demo", "video", "courses/demo/trailer.mp4");
const AUDIO = asset("aud-demo", "audio", "courses/demo/track.mp3");
const ALL = [POSTER, SAMPLE, CAPTIONS, TRANSCRIPT, TEMPLATE, FONT, REAL].map((entry) => ({ asset: entry, title: "Demo Course" }));

let dir: string;
let storage: Storage;
let ffmpeg: boolean;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "placeholder-test-"));
  storage = createLocalStorage("public", { rootDir: dir });
  ffmpeg = await hasFfmpeg();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const actionOf = (result: Awaited<ReturnType<typeof makePlaceholderAssets>>, id: string) => result.outcomes.find((outcome) => outcome.id === id)?.action;

describe("make-placeholder-assets", () => {
  it("writes a file and a marker for every placeholder entry, and nothing for a real asset", async () => {
    const result = await makePlaceholderAssets({ storage, assets: ALL });
    for (const entry of [POSTER, SAMPLE, CAPTIONS, TRANSCRIPT, TEMPLATE]) {
      expect(actionOf(result, entry.id), entry.id).toBe("created");
      expect(await storage.exists(entry.storageKey)).toBe(true);
      expect(await storage.exists(markerKeyFor(entry.storageKey))).toBe(true);
    }
    expect(result.notPlaceholders).toBe(1);
    expect(result.outcomes.some((outcome) => outcome.id === REAL.id)).toBe(false);
    expect(await storage.exists(REAL.storageKey)).toBe(false);
    expect(actionOf(result, FONT.id)).toBe("skipped_unsupported");
    expect(await storage.exists(FONT.storageKey)).toBe(false);
  });

  it("makes images that are PNG illustrations with the right content types", async () => {
    for (const entry of [POSTER, SAMPLE]) {
      const stored = await storage.get(entry.storageKey);
      expect(stored?.contentType).toBe("image/png");
      expect(stored?.body.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    }
    // The sample image is drawn from flat shapes: 1024 x 1024, a handful of colours, never a photograph.
    const sample = await storage.get(SAMPLE.storageKey);
    expect(sample?.body.readUInt32BE(16)).toBe(1024);
    expect(sample?.body.readUInt32BE(20)).toBe(1024);
    expect((await storage.get(CAPTIONS.storageKey))?.contentType).toBe("text/vtt");
    expect((await storage.get(CAPTIONS.storageKey))?.body.toString("utf8")).toMatch(/^WEBVTT/);
    expect((await storage.get(TRANSCRIPT.storageKey))?.body.toString("utf8")).toContain("Demo Course");
    expect((await storage.get(TEMPLATE.storageKey))?.contentType).toBe("application/zip");
  });

  it("leaves its own untouched placeholders alone on a second run", async () => {
    const before = await storage.get(SAMPLE.storageKey);
    const result = await makePlaceholderAssets({ storage, assets: ALL });
    for (const entry of [POSTER, SAMPLE, CAPTIONS, TRANSCRIPT, TEMPLATE]) expect(actionOf(result, entry.id), entry.id).toBe("kept");
    expect((await storage.get(SAMPLE.storageKey))?.body.equals(before?.body ?? Buffer.alloc(0))).toBe(true);
  });

  it("redraws its own placeholders with force", async () => {
    const result = await makePlaceholderAssets({ storage, assets: ALL, force: true });
    expect(actionOf(result, CAPTIONS.id)).toBe("refreshed");
  });

  it("never overwrites a real file uploaded over a placeholder, even with force", async () => {
    const real = Buffer.from("the real, recorded captions file");
    await storage.put(CAPTIONS.storageKey, real, { contentType: "text/vtt" });
    for (const force of [false, true]) {
      const result = await makePlaceholderAssets({ storage, assets: ALL, force });
      expect(actionOf(result, CAPTIONS.id)).toBe("skipped_real");
      expect((await storage.get(CAPTIONS.storageKey))?.body.equals(real)).toBe(true);
    }
  });

  it("never overwrites a file it did not make, when the manifest still says placeholder", async () => {
    const uploaded = asset("img-uploaded", "image", "courses/demo/uploaded-first.png");
    const real = Buffer.from("real bytes that arrived before the generator ever ran");
    await storage.put(uploaded.storageKey, real, { contentType: "image/png" });
    const result = await makePlaceholderAssets({ storage, assets: [{ asset: uploaded }], force: true });
    expect(actionOf(result, uploaded.id)).toBe("skipped_real");
    expect((await storage.get(uploaded.storageKey))?.body.equals(real)).toBe(true);
    expect(await storage.exists(markerKeyFor(uploaded.storageKey))).toBe(false);
  });

  it("makes a short MP4 and an MP3 when ffmpeg is installed, and says so when it is not", async () => {
    const result = await makePlaceholderAssets({ storage, assets: [{ asset: VIDEO, title: "Demo Course" }, { asset: AUDIO }] });
    if (!ffmpeg) {
      expect(actionOf(result, VIDEO.id)).toBe("skipped_unsupported");
      expect(await storage.exists(VIDEO.storageKey)).toBe(false);
      return;
    }
    expect(actionOf(result, VIDEO.id)).toBe("created");
    const video = await storage.get(VIDEO.storageKey);
    expect(video?.contentType).toBe("video/mp4");
    expect(video?.body.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(video?.size ?? 0).toBeLessThan(500_000);
    expect((await storage.get(AUDIO.storageKey))?.contentType).toBe("audio/mpeg");
  });

  it("treats a missing ffmpeg as a skip for video only", async () => {
    const other = asset("vid-other", "video", "courses/demo/other.mp4");
    const result = await makePlaceholderAssets({ storage, ffmpegPath: "/nonexistent/ffmpeg", assets: [{ asset: other }, { asset: asset("vtt-other", "captions_vtt", "courses/demo/other.en.vtt") }] });
    expect(result.ffmpeg).toBe(false);
    expect(actionOf(result, other.id)).toBe("skipped_unsupported");
    expect(actionOf(result, "vtt-other")).toBe("created");
  });
});
