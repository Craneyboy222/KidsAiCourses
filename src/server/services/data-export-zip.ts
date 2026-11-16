import { crc32, deflateRawSync } from "node:zlib";

/**
 * A small ZIP writer for data exports (spec 3.6: "ZIP of JSON plus artefacts we hold").
 * Standard ZIP 2.0 with deflate, UTF-8 names and no ZIP64, which is plenty for an export capped
 * well under 4 GB. Written here rather than adding a dependency for one use.
 */
export type ZipEntry = { name: string; data: Buffer | string; /** Already-compressed media gains nothing from deflate. */ store?: boolean };

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/** A path that is safe inside an archive: forward slashes, no `..`, no leading slash, no control characters. */
export function safeZipPath(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "").trim().replace(/^\.+/, "").slice(0, 120))
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join("/") : "file";
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107);
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export function buildZip(entries: ZipEntry[], now: Date): Buffer {
  if (entries.length > MAX_ENTRIES) throw new Error("Too many files for one export");
  const stamp = dosDateTime(now);
  const seen = new Set<string>();
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    let path = safeZipPath(entry.name);
    // Two files that clean to the same path would shadow each other when unpacked.
    for (let n = 2; seen.has(path); n += 1) path = safeZipPath(entry.name).replace(/(\.[^./]+)?$/, `-${n}$1`);
    seen.add(path);

    const name = Buffer.from(path, "utf8");
    const raw = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data;
    const deflated = entry.store ? raw : deflateRawSync(raw);
    const useDeflate = !entry.store && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const checksum = crc32(raw);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // names are UTF-8
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.day, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(useDeflate ? 8 : 0, 10);
    record.writeUInt16LE(stamp.time, 12);
    record.writeUInt16LE(stamp.day, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);

    local.push(header, name, body);
    central.push(record, name);
    offset += header.length + name.length + body.length;
    if (offset > MAX_BYTES) throw new Error("The export is too large for one archive");
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
