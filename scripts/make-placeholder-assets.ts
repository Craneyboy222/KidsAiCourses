/**
 * `pnpm exec tsx scripts/make-placeholder-assets.ts [--force]` — makes stand-in files for every
 * asset marked `"placeholder": true` in `content/assets/*.json` and writes them to storage under
 * their keys (the `public` bucket, where course media lives), so that trailers, captions,
 * transcripts, posters, sample images, music beds and templates exist in local development.
 * `pnpm db:seed` calls `makePlaceholderAssets()`.
 *
 * What it makes, all of it generated here (nothing is downloaded, nothing is a recording):
 * - `video`: a short title-card MP4 (ffmpeg: a drawn card held for a few seconds, silent audio);
 * - `captions_vtt`: WebVTT captions that match the title card; `transcript_md`: the same words;
 * - `image` / `guide_screenshot`: a PNG drawn from shapes. A poster is a title card. A sample
 *   image is an abstract avatar made of circles and blocks. NEVER a photo of a person;
 * - `audio`: a few seconds of generated tones (MP3); `template_zip`: a one-file zip;
 *   `dataset_csv`: a tiny made-up table. `font` cannot be faked and is skipped.
 *
 * It never overwrites a real asset:
 * - an entry without `"placeholder": true` is never touched;
 * - when a file already exists under the key, it is replaced only if this script made it AND it
 *   has not changed since. That is known from a marker stored beside it
 *   (`placeholder-markers/<key>.json`, holding the file's SHA-256). A file uploaded over a
 *   placeholder has a different hash, counts as real, and is left alone for good.
 *
 * Safe to run again: an untouched placeholder is kept as it is (`--force` redraws it).
 * Loads `.env.local` unless `DOTENV_PATH` names another file.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { crc32, deflateSync } from "node:zlib";
import { config } from "dotenv";
import type { ManifestAsset } from "@/content/asset-schema";
import { getStorage, type Storage } from "@/server/storage";
import { loadContent } from "./check-content";

const run = promisify(execFile);

export const PLACEHOLDER_GENERATOR = "make-placeholder-assets";
export const PLACEHOLDER_VERSION = 1;
export const PLACEHOLDER_NOTE = "PLACEHOLDER — the real file has not been made yet";
/** Seconds. Short on purpose: these are stand-ins, and local storage should stay small. */
export const PLACEHOLDER_VIDEO_SECONDS = 6;
export const PLACEHOLDER_AUDIO_SECONDS = 8;

export type PlaceholderAction =
  /** Nothing was stored under the key, so a placeholder was written. */
  | "created"
  /** Our own untouched placeholder was drawn again (`--force`, or a newer generator). */
  | "refreshed"
  /** Our own untouched placeholder is already there. */
  | "kept"
  /** A file that this script did not make (or that has changed since) is stored there. Never overwritten. */
  | "skipped_real"
  /** This kind cannot be generated (a font), or ffmpeg is missing for it. */
  | "skipped_unsupported";

export type PlaceholderOutcome = { id: string; kind: ManifestAsset["kind"]; storageKey: string; action: PlaceholderAction; detail?: string };

export type PlaceholderResult = {
  outcomes: PlaceholderOutcome[];
  /** Manifest entries without `placeholder: true`: real assets, not looked at. */
  notPlaceholders: number;
  ffmpeg: boolean;
};

export type PlaceholderOptions = {
  /** Repository root holding `content/`. Default: this repository. */
  rootDir?: string;
  /** Where to write. Default: the `public` bucket. */
  storage?: Storage;
  /** Redraw placeholders this script made earlier. Real assets are still never touched. */
  force?: boolean;
  /** The ffmpeg binary. Default `ffmpeg` on the PATH. */
  ffmpegPath?: string;
  /** Give the entries directly instead of reading `content/assets` (tests). */
  assets?: Array<{ asset: ManifestAsset; title?: string }>;
};

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Where the marker for a storage key lives. Markers are small JSON files in the same bucket. */
export const markerKeyFor = (storageKey: string): string => `placeholder-markers/${storageKey}.json`;

type Marker = { generator: string; version: number; assetId: string; sha256: string };

async function readMarker(storage: Storage, storageKey: string): Promise<Marker | null> {
  const stored = await storage.get(markerKeyFor(storageKey));
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored.body.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const m = parsed as Record<string, unknown>;
    if (m.generator !== PLACEHOLDER_GENERATOR || typeof m.version !== "number" || typeof m.sha256 !== "string" || typeof m.assetId !== "string") return null;
    return { generator: m.generator, version: m.version, assetId: m.assetId, sha256: m.sha256 };
  } catch {
    return null;
  }
}

// ───────────────────────────── Drawing (no photographs, ever) ─────────────────────────────

type Rgb = readonly [number, number, number];

/** A tiny canvas: enough for flat shapes. */
class Canvas {
  readonly pixels: Buffer;
  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.pixels = Buffer.alloc(width * height * 3);
    this.rect(0, 0, width, height, background);
  }

  private set(x: number, y: number, [r, g, b]: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const at = (y * this.width + x) * 3;
    this.pixels[at] = r;
    this.pixels[at + 1] = g;
    this.pixels[at + 2] = b;
  }

  rect(x: number, y: number, w: number, h: number, colour: Rgb): void {
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(this.height, Math.ceil(y + h)); py += 1) {
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(this.width, Math.ceil(x + w)); px += 1) this.set(px, py, colour);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, colour: Rgb): void {
    for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
      for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
        const dx = (px - cx) / rx;
        const dy = (py - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(px, py, colour);
      }
    }
  }

  /** PNG, 8-bit RGB, no interlace. */
  toPng(): Buffer {
    const chunk = (type: string, data: Buffer): Buffer => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "latin1");
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])) >>> 0, 0);
      return Buffer.concat([head, data, tail]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // colour type: RGB
    const stride = this.width * 3;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (stride + 1)] = 0; // filter: none
      this.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
  }
}

type Palette = readonly [Rgb, Rgb, Rgb, Rgb, Rgb];
const DEFAULT_PALETTE: Palette = [[24, 32, 62], [255, 196, 61], [72, 201, 176], [238, 108, 77], [245, 245, 240]];
const PALETTES: readonly Palette[] = [
  DEFAULT_PALETTE,
  [[30, 27, 75], [250, 204, 21], [56, 189, 248], [244, 114, 182], [248, 250, 252]],
  [[20, 48, 46], [253, 186, 116], [134, 239, 172], [96, 165, 250], [250, 250, 245]],
  [[49, 24, 71], [251, 146, 60], [94, 234, 212], [196, 181, 253], [250, 245, 255]],
];

/** A number from a string, so each asset always gets the same colours and shapes. */
function seedOf(text: string): number {
  return createHash("sha256").update(text).digest().readUInt32BE(0);
}
const paletteFor = (seed: number): Palette => PALETTES[seed % PALETTES.length] ?? DEFAULT_PALETTE;

/** A title card: a dark panel, a band, a few shapes. The words are added by ffmpeg when a font is available. */
function drawTitleCard(seed: number, width = 1280, height = 720): Canvas {
  const [bg, accent, second, third] = paletteFor(seed);
  const canvas = new Canvas(width, height, bg);
  canvas.ellipse(width * 0.86, height * 0.2, height * 0.26, height * 0.26, second);
  canvas.ellipse(width * 0.93, height * 0.52, height * 0.12, height * 0.12, third);
  canvas.rect(0, height * 0.82, width, height * 0.035, accent);
  canvas.rect(width * 0.06, height * 0.16, width * 0.012, height * 0.5, accent);
  for (let i = 0; i < 5; i += 1) canvas.rect(width * (0.66 + i * 0.045), height * 0.9, width * 0.03, height * 0.03, i % 2 === 0 ? second : third);
  return canvas;
}

/**
 * An abstract avatar: a round "head", a block "body" and two dot "eyes" on a patterned background.
 * It is made of five flat shapes so that nobody could mistake it for a picture of a real person
 * (spec Section 15: no evidence or sample that shows a real person).
 */
function drawAbstractAvatar(seed: number, width = 1024, height = 1024): Canvas {
  const [bg, accent, second, third, light] = paletteFor(seed);
  const canvas = new Canvas(width, height, light);
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if ((row + col + seed) % 3 === 0) canvas.rect((col * width) / 8, (row * height) / 8, width / 8, height / 8, (row + col) % 2 === 0 ? second : third);
    }
  }
  canvas.ellipse(width / 2, height * 0.56, width * 0.4, height * 0.4, bg);
  canvas.rect(width * 0.3, height * 0.62, width * 0.4, height * 0.3, accent); // body: a plain block
  canvas.ellipse(width / 2, height * 0.42, width * 0.17, height * 0.17, accent); // head: a plain circle
  canvas.ellipse(width * 0.44, height * 0.41, width * 0.022, height * 0.022, bg);
  canvas.ellipse(width * 0.56, height * 0.41, width * 0.022, height * 0.022, bg);
  canvas.rect(width * 0.455, height * 0.475, width * 0.09, height * 0.012, bg);
  return canvas;
}

// ───────────────────────────── ffmpeg ─────────────────────────────

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
];
const findFont = (): string | null => FONT_CANDIDATES.find((file) => existsSync(file)) ?? null;

export async function hasFfmpeg(ffmpegPath = "ffmpeg"): Promise<boolean> {
  try {
    await run(ffmpegPath, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/** Text for a drawtext filter: only plain characters, so nothing needs escaping and no option can be injected. */
const cardText = (text: string, max: number): string =>
  text
    .replace(/[^A-Za-z0-9 .,!?&()+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Breaks a title into at most three lines of about `width` characters. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Adds the words to a title card. Returns the card unchanged when there is no ffmpeg or no font. */
async function addCardText(ffmpegPath: string, dir: string, card: Buffer, title: string, label: string): Promise<Buffer> {
  const font = findFont();
  if (!font) return card;
  const input = join(dir, "card-in.png");
  const output = join(dir, "card-out.png");
  await writeFile(input, card);
  const fontOption = `fontfile=${font.replace(/\\/g, "/").replace(/:/g, "\\:")}`;
  const draws = [
    ...wrap(cardText(title, 90), 28).map((line, index) => `drawtext=${fontOption}:text='${line}':fontcolor=white:fontsize=58:x=130:y=${150 + index * 78}`),
    `drawtext=${fontOption}:text='${cardText(label, 60)}':fontcolor=0xFFD166:fontsize=30:x=130:y=450`,
    `drawtext=${fontOption}:text='${cardText("Placeholder. The real file has not been made yet.", 80)}':fontcolor=white:fontsize=24:x=130:y=520`,
  ];
  try {
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", draws.join(","), "-frames:v", "1", output]);
    return await readFile(output);
  } catch {
    return card; // a font the build of ffmpeg cannot read: the card still works without words
  }
}

async function makeVideo(ffmpegPath: string, dir: string, card: Buffer): Promise<Buffer> {
  const input = join(dir, "video-card.png");
  const output = join(dir, "video.mp4");
  await writeFile(input, card);
  await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-framerate", "12", "-i", input,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=22050",
    "-t", String(PLACEHOLDER_VIDEO_SECONDS),
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "30", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "32k", "-shortest", "-movflags", "+faststart",
    output,
  ]);
  return readFile(output);
}

async function makeAudio(ffmpegPath: string, dir: string, seed: number): Promise<Buffer> {
  const output = join(dir, "audio.mp3");
  const notes = [220, 277, 330, 392, 440, 523];
  const a = notes[seed % notes.length] ?? 220;
  const b = notes[(seed >> 3) % notes.length] ?? 330;
  await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=${a}:duration=${PLACEHOLDER_AUDIO_SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=${b}:duration=${PLACEHOLDER_AUDIO_SECONDS}`,
    "-filter_complex", `[0:a][1:a]amix=inputs=2,volume=0.25,afade=t=in:d=1,afade=t=out:st=${PLACEHOLDER_AUDIO_SECONDS - 1}:d=1`,
    "-c:a", "libmp3lame", "-b:a", "64k",
    output,
  ]);
  return readFile(output);
}

// ───────────────────────────── Text files and zip ─────────────────────────────

const stamp = (seconds: number): string => `00:00:${String(Math.floor(seconds)).padStart(2, "0")}.000`;

export function placeholderCaptions(title: string): string {
  const half = PLACEHOLDER_VIDEO_SECONDS / 2;
  return ["WEBVTT", "", "1", `${stamp(0)} --> ${stamp(half)}`, `[Title card] ${title}`, "", "2", `${stamp(half)} --> ${stamp(PLACEHOLDER_VIDEO_SECONDS)}`, "This is a placeholder video. The real one has not been recorded yet.", ""].join("\n");
}

export function placeholderTranscript(title: string): string {
  return [`# Transcript: ${title}`, "", `> ${PLACEHOLDER_NOTE}.`, "", `**[Title card]** ${title}`, "", "This is a placeholder video. The real one has not been recorded yet. When it is, this transcript will be replaced with the full words of the video.", ""].join("\n");
}

/** A zip holding one stored (uncompressed) file. Enough for a template stand-in, with no dependency. */
export function singleFileZip(name: string, content: Buffer): Buffer {
  const fileName = Buffer.from(name, "utf8");
  const sum = crc32(content) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(0x21, 12); // date: 1 January 1980
  local.writeUInt32LE(sum, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(sum, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const centralOffset = local.length + fileName.length + content.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, fileName, content, central, fileName, end]);
}

// ───────────────────────────── The generator ─────────────────────────────

/** "courses/snaplab/trailer-poster.png" → "trailer poster". */
const labelFromKey = (storageKey: string): string =>
  (storageKey.split("/").pop() ?? storageKey)
    .replace(/\.[a-z0-9.]+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

const isTitleCardImage = (asset: ManifestAsset): boolean => /poster|title|card|cover|thumb/i.test(asset.storageKey);

type Made = { body: Buffer; contentType: string } | { unsupported: string };

async function generate(asset: ManifestAsset, title: string, ctx: { ffmpeg: boolean; ffmpegPath: string; dir: string }): Promise<Made> {
  const seed = seedOf(asset.id);
  const label = labelFromKey(asset.storageKey);
  switch (asset.kind) {
    case "video": {
      if (!ctx.ffmpeg) return { unsupported: "ffmpeg is not installed, so no video was made" };
      const card = await addCardText(ctx.ffmpegPath, ctx.dir, drawTitleCard(seed).toPng(), title, label);
      return { body: await makeVideo(ctx.ffmpegPath, ctx.dir, card), contentType: "video/mp4" };
    }
    case "audio": {
      if (!ctx.ffmpeg) return { unsupported: "ffmpeg is not installed, so no audio was made" };
      return { body: await makeAudio(ctx.ffmpegPath, ctx.dir, seed), contentType: "audio/mpeg" };
    }
    case "captions_vtt":
      return { body: Buffer.from(placeholderCaptions(title), "utf8"), contentType: "text/vtt" };
    case "transcript_md":
      return { body: Buffer.from(placeholderTranscript(title), "utf8"), contentType: "text/markdown" };
    case "image":
    case "guide_screenshot": {
      if (!isTitleCardImage(asset)) return { body: drawAbstractAvatar(seed).toPng(), contentType: "image/png" };
      const card = drawTitleCard(seed).toPng();
      return { body: ctx.ffmpeg ? await addCardText(ctx.ffmpegPath, ctx.dir, card, title, label) : card, contentType: "image/png" };
    }
    case "template_zip": {
      const text = [`# ${title}: ${label}`, "", `> ${PLACEHOLDER_NOTE}.`, "", "Use this page as your template for now:", "", "1. What I am making:", "2. Who it is for:", "3. What I tried, and what happened:", "4. What I would change next time:", ""].join("\n");
      return { body: singleFileZip(`${label.replace(/\s+/g, "-") || "template"}.md`, Buffer.from(text, "utf8")), contentType: "application/zip" };
    }
    case "dataset_csv":
      return { body: Buffer.from(["item,value,note", "alpha,1,made-up placeholder row", "beta,2,made-up placeholder row", "gamma,3,made-up placeholder row", ""].join("\n"), "utf8"), contentType: "text/csv" };
    case "font":
      return { unsupported: "a font cannot be generated: upload the licensed file" };
  }
}

/** Course title for each asset id, found by looking for the id in each course file. */
function titlesByAsset(content: ReturnType<typeof loadContent>): Map<string, string> {
  const titles = new Map<string, string>();
  for (const { course } of content.courses) {
    const text = JSON.stringify(course);
    for (const { asset } of content.assets) {
      if (!titles.has(asset.id) && text.includes(`"${asset.id}"`)) titles.set(asset.id, course.title);
    }
  }
  return titles;
}

export async function makePlaceholderAssets(options: PlaceholderOptions = {}): Promise<PlaceholderResult> {
  const storage = options.storage ?? getStorage("public");
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  let entries: Array<{ asset: ManifestAsset; title?: string }>;
  if (options.assets) entries = options.assets;
  else {
    const content = loadContent(options.rootDir);
    const titles = titlesByAsset(content);
    entries = content.assets.map(({ asset }) => ({ asset, title: titles.get(asset.id) }));
  }

  const result: PlaceholderResult = { outcomes: [], notPlaceholders: 0, ffmpeg: await hasFfmpeg(ffmpegPath) };
  const dir = await mkdtemp(join(tmpdir(), "placeholder-assets-"));
  try {
    for (const { asset, title } of entries) {
      if (asset.placeholder !== true) {
        // A real asset. Whatever is or is not in storage, it is not ours to write.
        result.notPlaceholders += 1;
        continue;
      }
      const outcome = (action: PlaceholderAction, detail?: string): void => {
        result.outcomes.push({ id: asset.id, kind: asset.kind, storageKey: asset.storageKey, action, ...(detail ? { detail } : {}) });
      };

      const existing = await storage.get(asset.storageKey);
      let action: "created" | "refreshed" = "created";
      if (existing) {
        const marker = await readMarker(storage, asset.storageKey);
        const ours = marker !== null && marker.sha256 === sha256(existing.body);
        if (!ours) {
          outcome("skipped_real", marker ? "the stored file has changed since the placeholder was made" : "a file this script did not make is stored under this key");
          continue;
        }
        if (!options.force && marker.version === PLACEHOLDER_VERSION) {
          outcome("kept");
          continue;
        }
        action = "refreshed";
      }

      const made = await generate(asset, title ?? "Course media", { ffmpeg: result.ffmpeg, ffmpegPath, dir });
      if ("unsupported" in made) {
        outcome("skipped_unsupported", made.unsupported);
        continue;
      }
      // The marker goes first: if the run dies between the two writes, the worst case is a marker
      // whose hash matches nothing, which reads as "real" and is left alone.
      const marker: Marker = { generator: PLACEHOLDER_GENERATOR, version: PLACEHOLDER_VERSION, assetId: asset.id, sha256: sha256(made.body) };
      await storage.put(markerKeyFor(asset.storageKey), JSON.stringify(marker), { contentType: "application/json" });
      await storage.put(asset.storageKey, made.body, { contentType: made.contentType });
      outcome(action);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return result;
}

export function formatPlaceholderResult(result: PlaceholderResult): string {
  const count = (action: PlaceholderAction): number => result.outcomes.filter((outcome) => outcome.action === action).length;
  const lines = [
    `Placeholder assets: ${count("created")} created, ${count("refreshed")} redrawn, ${count("kept")} already there, ${count("skipped_real")} real files left alone, ${count("skipped_unsupported")} not generated; ${result.notPlaceholders} manifest entries are real assets and were not looked at.`,
  ];
  if (!result.ffmpeg) lines.push("  ffmpeg was not found, so videos and audio were not made. Install ffmpeg and run this again.");
  for (const outcome of result.outcomes) {
    if (outcome.action === "skipped_real" || outcome.action === "skipped_unsupported") lines.push(`  ${outcome.id} (${outcome.storageKey}): ${outcome.action === "skipped_real" ? "left alone" : "not generated"} — ${outcome.detail ?? ""}`);
  }
  return lines.join("\n");
}

async function main(argv: readonly string[]): Promise<void> {
  // DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
  config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
  const unknown = argv.filter((arg) => arg !== "--force");
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown.join(" ")}\nUsage: pnpm exec tsx scripts/make-placeholder-assets.ts [--force]`);
    process.exitCode = 2;
    return;
  }
  console.info(formatPlaceholderResult(await makePlaceholderAssets({ force: argv.includes("--force") })));
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error("Placeholder assets failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
