// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  blankVideoMetadata,
  canonicalMime,
  checkDeclaredUpload,
  checkEvidenceLinkShape,
  decideSubmission,
  inspectUpload,
  isSampled,
  matchLinkToTool,
  maxBytesFor,
  stripImageMetadata,
  type CheckedItem,
} from "@/server/services/evidence-checks";
import { exeBytes, jpegWithExif, mp4WithLocation, pdfBytes, pngWithText, webpWithExif } from "./fixtures";

const LIMITS = { screenshot: 10, file: 25, video: 200 };
const MB = 1024 * 1024;
const SECRET = "GPS 51.5007,-0.1246";

describe("what the browser declares", () => {
  it("takes the allowed types for each kind, whatever the spelling", () => {
    expect(checkDeclaredUpload({ kind: "screenshot", contentType: "image/png", sizeBytes: 1000 }, LIMITS)).toEqual({ ok: true, mime: "image/png", maxBytes: 10 * MB });
    expect(checkDeclaredUpload({ kind: "screenshot", contentType: "IMAGE/JPG; charset=binary", sizeBytes: 1000 }, LIMITS)).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(checkDeclaredUpload({ kind: "video", contentType: "video/mp4", sizeBytes: 1000 }, LIMITS)).toMatchObject({ ok: true, maxBytes: 200 * MB });
    expect(checkDeclaredUpload({ kind: "file", contentType: "application/pdf", sizeBytes: 1000 }, LIMITS)).toMatchObject({ ok: true, maxBytes: 25 * MB });
    expect(canonicalMime("audio/x-m4a")).toBe("audio/mp4");
  });

  it.each([
    ["screenshot", "image/gif"],
    ["screenshot", "image/svg+xml"],
    ["screenshot", "image/heic"],
    ["screenshot", "application/pdf"],
    ["video", "video/x-msvideo"],
    ["video", "image/png"],
    ["file", "application/zip"],
    ["file", "text/html"],
    ["file", "application/x-msdownload"],
    ["file", "image/png"],
    ["file", ""],
  ] as const)("refuses a %s declared as %s", (kind, contentType) => {
    const result = checkDeclaredUpload({ kind, contentType, sizeBytes: 1000 }, LIMITS);
    expect(result.ok).toBe(false);
  });

  it("applies the size limit for the kind, from the setting", () => {
    expect(maxBytesFor("screenshot", LIMITS)).toBe(10 * MB);
    expect(checkDeclaredUpload({ kind: "screenshot", contentType: "image/png", sizeBytes: 10 * MB }, LIMITS).ok).toBe(true);
    const tooBig = checkDeclaredUpload({ kind: "screenshot", contentType: "image/png", sizeBytes: 10 * MB + 1 }, LIMITS);
    expect(tooBig).toMatchObject({ ok: false });
    expect(!tooBig.ok && tooBig.message).toContain("10 MB");
    expect(checkDeclaredUpload({ kind: "screenshot", contentType: "image/png", sizeBytes: 3 * MB }, { ...LIMITS, screenshot: 2 }).ok).toBe(false);
    expect(checkDeclaredUpload({ kind: "file", contentType: "application/pdf", sizeBytes: 0 }, LIMITS).ok).toBe(false);
    expect(checkDeclaredUpload({ kind: "file", contentType: "application/pdf", sizeBytes: Number.NaN }, LIMITS).ok).toBe(false);
  });
});

describe("what actually arrived", () => {
  const inspect = (bytes: Buffer, kind: "screenshot" | "file" | "video", declaredType: string, maxBytes = 10 * MB) => inspectUpload(bytes, { kind, declaredType, maxBytes });

  it("accepts a real PNG, JPG and WebP as a screenshot", async () => {
    expect(await inspect(pngWithText(), "screenshot", "image/png")).toMatchObject({ ok: true, mime: "image/png", ext: "png", isMedia: true });
    expect(await inspect(jpegWithExif(), "screenshot", "image/jpeg")).toMatchObject({ ok: true, mime: "image/jpeg", ext: "jpg", isMedia: true });
    expect(await inspect(webpWithExif(), "screenshot", "image/webp")).toMatchObject({ ok: true, mime: "image/webp", ext: "webp" });
  });

  it("refuses a file whose real type is not the type it was declared as", async () => {
    expect(await inspect(jpegWithExif(), "screenshot", "image/png")).toMatchObject({ ok: false, reason: "type_mismatch" });
    expect(await inspect(pngWithText(), "screenshot", "image/jpeg")).toMatchObject({ ok: false, reason: "type_mismatch" });
  });

  it("refuses a program, an archive or a web page dressed up as something else", async () => {
    expect(await inspect(exeBytes(), "screenshot", "image/png")).toMatchObject({ ok: false });
    expect(await inspect(exeBytes(), "file", "application/pdf")).toMatchObject({ ok: false });
    expect(await inspect(Buffer.from("<!DOCTYPE html><html><script>alert(1)</script></html>"), "file", "text/plain")).toMatchObject({ ok: false, reason: "type_not_allowed" });
    expect(await inspect(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "file", "text/plain")).toMatchObject({ ok: false });
    expect(await inspect(Buffer.from([0, 1, 2, 3, 0, 255, 254]), "file", "text/plain")).toMatchObject({ ok: false });
  });

  it("does not take a picture or a video through the documents door", async () => {
    expect(await inspect(pngWithText(), "file", "image/png")).toMatchObject({ ok: false, reason: "type_not_allowed" });
    expect(await inspect(pngWithText(), "file", "application/pdf")).toMatchObject({ ok: false });
    expect(await inspect(mp4WithLocation(), "file", "video/mp4")).toMatchObject({ ok: false });
    expect(await inspect(pdfBytes(), "screenshot", "application/pdf")).toMatchObject({ ok: false });
  });

  it("accepts a PDF and plain text as a file, and they are not media", async () => {
    expect(await inspect(pdfBytes(), "file", "application/pdf")).toMatchObject({ ok: true, mime: "application/pdf", ext: "pdf", isMedia: false });
    expect(await inspect(Buffer.from("# My prompt library\n\nSix cards.\n"), "file", "text/markdown")).toMatchObject({ ok: true, mime: "text/markdown", ext: "md", isMedia: false });
    expect(await inspect(Buffer.from("a,b\n1,2\n"), "file", "text/csv")).toMatchObject({ ok: true, ext: "csv" });
  });

  it("accepts an MP4 as a video", async () => {
    expect(await inspect(mp4WithLocation(), "video", "video/mp4")).toMatchObject({ ok: true, mime: "video/mp4", ext: "mp4", isMedia: true });
    expect(await inspect(mp4WithLocation(), "video", "video/webm")).toMatchObject({ ok: false, reason: "type_mismatch" });
  });

  it("refuses an empty file and one over the limit", async () => {
    expect(await inspect(Buffer.alloc(0), "screenshot", "image/png")).toMatchObject({ ok: false, reason: "empty" });
    expect(await inspect(pngWithText(), "screenshot", "image/png", 20)).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("returns images with their metadata gone", async () => {
    for (const [bytes, mime] of [[pngWithText(SECRET), "image/png"], [jpegWithExif(SECRET), "image/jpeg"], [webpWithExif(SECRET), "image/webp"]] as const) {
      expect(bytes.includes(SECRET)).toBe(true);
      const result = await inspect(bytes, "screenshot", mime);
      expect(result.ok && result.bytes.includes(SECRET)).toBe(false);
      expect(result.ok && result.bytes.length).toBeLessThan(bytes.length);
    }
  });
});

describe("metadata removal", () => {
  it("keeps a PNG's picture chunks and drops text, EXIF and anything after the end", () => {
    const cleaned = stripImageMetadata(Buffer.concat([pngWithText(SECRET), Buffer.from("extra")]), "image/png");
    expect(cleaned).not.toBeNull();
    const text = cleaned?.toString("latin1") ?? "";
    expect(text).toContain("IHDR");
    expect(text).toContain("IDAT");
    expect(text.endsWith("IEND\xae\x42\x60\x82")).toBe(true);
    expect(text).not.toContain("tEXt");
    expect(text).not.toContain("eXIf");
    expect(text).not.toContain(SECRET);
  });

  it("keeps a JPEG decodable: JFIF, tables and scan data stay, EXIF, comments and trailing bytes go", () => {
    const cleaned = stripImageMetadata(jpegWithExif(SECRET), "image/jpeg");
    expect(cleaned).not.toBeNull();
    const text = cleaned?.toString("latin1") ?? "";
    expect(text.startsWith("\xff\xd8\xff\xe0")).toBe(true);
    expect(text).toContain("JFIF");
    expect(text.endsWith("\x56\xff\xd0\x78\xff\xd9")).toBe(true);
    expect(text).not.toContain("Exif");
    expect(text).not.toContain(SECRET);
  });

  it("rewrites a WebP without EXIF or XMP, with the right length and flags", () => {
    const cleaned = stripImageMetadata(webpWithExif(SECRET), "image/webp");
    expect(cleaned).not.toBeNull();
    if (!cleaned) return;
    expect(cleaned.readUInt32LE(4)).toBe(cleaned.length - 8);
    expect(cleaned.toString("latin1")).not.toContain("EXIF");
    expect(cleaned.toString("latin1")).not.toContain(SECRET);
    // VP8X flags byte: EXIF (0x08) and XMP (0x04) cleared.
    expect((cleaned[20] ?? 0xff) & 0x0c).toBe(0);
  });

  it("gives null for something that is not a readable image, so it is refused", () => {
    expect(stripImageMetadata(Buffer.from("not an image"), "image/png")).toBeNull();
    expect(stripImageMetadata(jpegWithExif().subarray(0, 40), "image/jpeg")).toBeNull();
    expect(stripImageMetadata(pngWithText().subarray(0, 30), "image/png")).toBeNull();
    expect(stripImageMetadata(pngWithText(), "image/gif")).toBeNull();
  });

  it("blanks a video's metadata boxes without moving anything", () => {
    const original = mp4WithLocation("+51.5007-000.1246/");
    const cleaned = blankVideoMetadata(original);
    expect(cleaned.length).toBe(original.length);
    const text = cleaned.toString("latin1");
    expect(text).not.toContain("udta");
    expect(text.match(/free/g)).toHaveLength(2);
    expect(text).toContain("ftyp");
    expect(text).toContain("mdat");
    // The input is left alone.
    expect(original.toString("latin1")).toContain("udta");
  });
});

describe("link rules", () => {
  it("accepts an https link on the public internet", () => {
    expect(checkEvidenceLinkShape("  https://replit.com/@maya/snap-app?v=1#top ")).toEqual({ ok: true, url: "https://replit.com/@maya/snap-app?v=1#top" });
  });

  it.each([
    ["nothing", ""],
    ["plain http", "http://replit.com/@maya/app"],
    ["not a web address", "replit.com/@maya/app"],
    ["a javascript link", "javascript:alert(1)"],
    ["a data link", "data:text/html,<script>alert(1)</script>"],
    ["a file link", "file:///etc/passwd"],
    ["sign-in details in the address", "https://maya:hunter2@replit.com/app"],
    ["an unusual port", "https://replit.com:8443/app"],
    ["localhost", "https://localhost/app"],
    ["a loopback address", "https://127.0.0.1/app"],
    ["a private address", "https://192.168.1.10/app"],
    ["another private address", "https://10.0.0.5/app"],
    ["the cloud metadata address", "https://169.254.169.254/latest/meta-data"],
    ["an IPv6 loopback", "https://[::1]/app"],
    ["an IPv4-mapped private address", "https://[::ffff:10.0.0.1]/app"],
    ["an internal host name", "https://intranet/app"],
    ["a .local name", "https://printer.local/app"],
    ["a space in the middle", "https://replit.com/my app"],
    ["a password in the query", "https://replit.com/app?password=hunter2"],
    ["a token in the query", "https://replit.com/app?access_token=abc123"],
    ["a one-time code in the query", "https://replit.com/app?otp=123456"],
    ["a very long address", `https://replit.com/${"a".repeat(2100)}`],
  ])("refuses %s", (_name, url) => {
    const result = checkEvidenceLinkShape(url);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message.length).toBeGreaterThan(10);
  });

  it("matches a link to a Register tool by parsed host and path, never by text", () => {
    const replit = { slug: "replit", name: "Replit", allowedUrlPrefixes: ["https://replit.com/"] };
    const canva = { slug: "canva", name: "Canva", allowedUrlPrefixes: ["https://www.canva.com/design/"] };
    expect(matchLinkToTool("https://replit.com/@maya/app", [canva, replit])?.slug).toBe("replit");
    expect(matchLinkToTool("https://www.canva.com/design/abc/view", [canva, replit])?.slug).toBe("canva");
    expect(matchLinkToTool("https://www.canva.com/designs", [canva])).toBeNull();
    expect(matchLinkToTool("https://replit.com.evil.example/@maya/app", [replit])).toBeNull();
    expect(matchLinkToTool("https://evil.example/https://replit.com/", [replit])).toBeNull();
    expect(matchLinkToTool("https://sub.replit.com/app", [replit])).toBeNull();
    expect(matchLinkToTool("https://replit.com/app", [])).toBeNull();
  });
});

describe("the review sample", () => {
  it("picks a submission when the roll falls under the rate", () => {
    expect(isSampled(0.1, 0.05)).toBe(true);
    expect(isSampled(0.1, 0.0999)).toBe(true);
    expect(isSampled(0.1, 0.1)).toBe(false);
    expect(isSampled(0.1, 0.9)).toBe(false);
  });

  it("samples nothing at 0 and everything at 1, and treats a bad rate as 0", () => {
    expect(isSampled(0, 0)).toBe(false);
    expect(isSampled(1, 0.999999)).toBe(true);
    expect(isSampled(Number.NaN, 0)).toBe(false);
    expect(isSampled(-1, 0)).toBe(false);
  });

  it("samples about the configured share over many rolls", () => {
    let picked = 0;
    for (let index = 0; index < 10_000; index += 1) if (isSampled(0.1, index / 10_000)) picked += 1;
    expect(picked).toBe(1000);
  });
});

describe("accept, hold or sample", () => {
  const link: CheckedItem = { kind: "link", peopleCheck: "declared_no_people", onRegister: true };
  const doc: CheckedItem = { kind: "file", peopleCheck: "not_applicable" };
  const base = { autoAccept: true, sampleRate: 0.1, roll: 0.5, textSeverity: null } as const;

  it("accepts a clean link and a clean document without a person", () => {
    expect(decideSubmission({ ...base, items: [link] })).toEqual({ decision: "accept", sampled: false, reasons: [] });
    expect(decideSubmission({ ...base, items: [link, doc] }).decision).toBe("accept");
  });

  it("holds a clean submission picked for the sample (D4)", () => {
    expect(decideSubmission({ ...base, roll: 0.01, items: [link] })).toEqual({ decision: "hold", sampled: true, reasons: ["sampled"], source: "sample", severity: "normal" });
  });

  it("holds everything when auto-accept is off", () => {
    expect(decideSubmission({ ...base, autoAccept: false, items: [link] })).toMatchObject({ decision: "hold", sampled: false, reasons: ["auto_accept_off"], source: "submission" });
  });

  it("never accepts an image or video file that no detector cleared (D3)", () => {
    for (const kind of ["screenshot", "video"] as const) {
      for (const peopleCheck of ["needs_human", "pending", "people_suspected", "not_applicable", "declared_no_people"] as const) {
        expect(decideSubmission({ ...base, sampleRate: 0, items: [link, { kind, peopleCheck }] })).toMatchObject({ decision: "hold", reasons: ["people_check_needed"], source: "auto" });
      }
    }
    expect(decideSubmission({ ...base, sampleRate: 0, items: [{ kind: "screenshot", peopleCheck: "clear" }] }).decision).toBe("accept");
  });

  it("holds a link that is not to one of the course's Register tools", () => {
    expect(decideSubmission({ ...base, items: [{ ...link, onRegister: false }] })).toMatchObject({ decision: "hold", reasons: ["link_off_register"] });
    expect(decideSubmission({ ...base, items: [{ kind: "link", peopleCheck: "declared_no_people" }] }).decision).toBe("hold");
  });

  it("holds flagged text at the severity of the flag", () => {
    expect(decideSubmission({ ...base, items: [link], textSeverity: "critical" })).toMatchObject({ decision: "hold", severity: "critical", reasons: ["text_flagged"], source: "auto" });
    expect(decideSubmission({ ...base, items: [link], textSeverity: "high" })).toMatchObject({ severity: "high" });
  });

  it("lists every reason, and a flagged item is not also counted as sampled", () => {
    const outcome = decideSubmission({ autoAccept: false, sampleRate: 1, roll: 0, textSeverity: "high", items: [{ ...link, onRegister: false }, { kind: "screenshot", peopleCheck: "needs_human" }] });
    expect(outcome).toMatchObject({ decision: "hold", sampled: false, reasons: ["text_flagged", "people_check_needed", "link_off_register", "auto_accept_off"], source: "auto" });
  });
});
