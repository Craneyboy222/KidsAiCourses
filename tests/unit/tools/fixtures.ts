import { crc32 } from "node:zlib";

/**
 * Tiny, hand-built files for the evidence tests. Each one is just enough of the format for its
 * signature to be recognised and for the metadata removal to have something to remove. None of
 * them is a picture of anything.
 */
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG with a text chunk (and an EXIF chunk) carrying `comment`. */
export function pngWithText(comment = "GPS 51.5007,-0.1246 taken on Maya's phone"): Buffer {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from(`Comment\0${comment}`, "latin1")),
    pngChunk("eXIf", Buffer.from(`Exif-${comment}`, "latin1")),
    pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

/** A JPEG with a JFIF header, an EXIF block carrying `comment`, a comment segment, scan data and bytes after the end marker. */
export function jpegWithExif(comment = "GPS 51.5007,-0.1246"): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    jpegSegment(0xe1, Buffer.from(`Exif\0\0${comment}`, "latin1")),
    jpegSegment(0xfe, Buffer.from(`note: ${comment}`, "latin1")),
    jpegSegment(0xdb, Buffer.alloc(65, 1)),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    // entropy-coded data with a stuffed 0xFF and a restart marker inside it
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]),
    Buffer.from([0xff, 0xd9]),
    Buffer.from(`trailing ${comment}`, "latin1"),
  ]);
}

function riffChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

/** A WebP with an extended header that announces EXIF and XMP, and both chunks carrying `comment`. */
export function webpWithExif(comment = "GPS 51.5007,-0.1246"): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c; // EXIF and XMP flags
  const body = Buffer.concat([riffChunk("VP8X", vp8x), riffChunk("VP8 ", Buffer.from([0x9d, 0x01, 0x2a, 1, 0, 1, 0, 0, 0, 0])), riffChunk("EXIF", Buffer.from(comment, "latin1")), riffChunk("XMP ", Buffer.from(`<x>${comment}</x>`, "latin1"))]);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length + 4, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}

function box(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, data]);
}

/** An MP4 with a user-data box (where phones write the place a clip was filmed) carrying `comment`. */
export function mp4WithLocation(comment = "+51.5007-000.1246/"): Buffer {
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("isom", "latin1"), Buffer.alloc(4), Buffer.from("isomiso2mp41", "latin1")]));
  const moov = box("moov", Buffer.concat([box("mvhd", Buffer.alloc(100)), box("trak", Buffer.concat([box("tkhd", Buffer.alloc(84)), box("udta", Buffer.from(`trak ${comment}`, "latin1"))])), box("udta", Buffer.from(comment, "latin1"))]));
  return Buffer.concat([ftyp, moov, box("mdat", Buffer.alloc(32, 7))]);
}

export const pdfBytes = (): Buffer => Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");

/** The start of a Windows program: never an allowed type, whatever it is called. */
export const exeBytes = (): Buffer => Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(126), Buffer.from("PE\0\0", "latin1"), Buffer.alloc(64)]);

/** Appends a people-detection fixture marker to a file (see `people-detection.ts`). */
export const withMarker = (bytes: Buffer, marker: string): Buffer => Buffer.concat([bytes, Buffer.from(marker, "latin1")]);
