import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CATEGORY_SLUGS } from "@/content/schema";
import { inQuietHours } from "@/lib/learning/time-rules";
import {
  MAX_BLOCKED_COURSES,
  MAX_DAILY_CAP_MIN,
  MAX_PAUSE_REASON,
  MIN_DAILY_CAP_MIN,
  cleanPauseReason,
  clockToMinutes,
  controlsInputSchema,
  minutesToClockValue,
  parseControlsForm,
  parseDailyCap,
  parseQuietHours,
  quietWindowLength,
  type ControlsFormValues,
} from "@/lib/parents/controls-rules";
import { buildZip, safeZipPath } from "@/server/services/data-export-zip";

const form = (patch: Partial<ControlsFormValues> = {}): ControlsFormValues => ({
  dailyCap: "none",
  quietEnabled: true,
  quietStart: "21:00",
  quietEnd: "07:00",
  blockedCategories: [],
  blockedCourseIds: [],
  requireApprovalForPro: false,
  ...patch,
});

const COURSE_A = "11111111-1111-4111-8111-111111111111";
const COURSE_B = "22222222-2222-4222-8222-222222222222";

describe("daily time cap", () => {
  it("treats an empty value, 'none' and 'off' as no limit", () => {
    for (const value of ["", "  ", "none", "NONE", "off", null, undefined]) expect(parseDailyCap(value)).toEqual({ ok: true, value: null });
  });

  it("accepts whole minutes between the bounds, as text or a number", () => {
    expect(parseDailyCap("60")).toEqual({ ok: true, value: 60 });
    expect(parseDailyCap(90)).toEqual({ ok: true, value: 90 });
    expect(parseDailyCap(String(MIN_DAILY_CAP_MIN))).toEqual({ ok: true, value: MIN_DAILY_CAP_MIN });
    expect(parseDailyCap(String(MAX_DAILY_CAP_MIN))).toEqual({ ok: true, value: MAX_DAILY_CAP_MIN });
  });

  it("refuses zero and anything below the shortest limit, and points to pausing instead", () => {
    for (const value of ["0", "1", String(MIN_DAILY_CAP_MIN - 1)]) {
      const result = parseDailyCap(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/pause/i);
    }
  });

  it("refuses more than twelve hours rather than rounding it down", () => {
    expect(parseDailyCap(String(MAX_DAILY_CAP_MIN + 1)).ok).toBe(false);
    expect(parseDailyCap("1440").ok).toBe(false);
  });

  it("refuses fractions, negatives, units and anything that is not a number", () => {
    for (const value of ["1.5", "-30", "60 minutes", "1h", "sixty", "6e1", "0x3c", "99999"]) expect(parseDailyCap(value).ok).toBe(false);
  });
});

describe("quiet hours", () => {
  it("reads 24-hour times and refuses everything else", () => {
    expect(clockToMinutes("00:00")).toBe(0);
    expect(clockToMinutes("07:05")).toBe(425);
    expect(clockToMinutes("21:00")).toBe(1260);
    expect(clockToMinutes("23:59")).toBe(1439);
    for (const value of ["24:00", "9:5", "21.00", "9pm", "", "12:60", "-1:00", "21:00:00"]) expect(clockToMinutes(value)).toBeNull();
  });

  it("writes minutes back as a time field value", () => {
    expect(minutesToClockValue(0)).toBe("00:00");
    expect(minutesToClockValue(425)).toBe("07:05");
    expect(minutesToClockValue(1260)).toBe("21:00");
    expect(minutesToClockValue(1440)).toBe("00:00");
  });

  it("stores 'off' as two equal values, whatever the time fields say", () => {
    expect(parseQuietHours({ enabled: false, start: "21:00", end: "07:00" })).toEqual({ ok: true, startMin: 0, endMin: 0 });
    expect(parseQuietHours({ enabled: false, start: "rubbish", end: "" })).toEqual({ ok: true, startMin: 0, endMin: 0 });
  });

  it("accepts a window that runs past midnight and one inside a single day", () => {
    expect(parseQuietHours({ enabled: true, start: "21:00", end: "07:00" })).toEqual({ ok: true, startMin: 1260, endMin: 420 });
    expect(parseQuietHours({ enabled: true, start: "13:00", end: "15:30" })).toEqual({ ok: true, startMin: 780, endMin: 930 });
    expect(quietWindowLength(1260, 420)).toBe(600);
    expect(quietWindowLength(780, 930)).toBe(150);
    expect(quietWindowLength(0, 0)).toBe(0);
  });

  it("refuses a window whose ends are the same: that would silently mean 'off'", () => {
    const result = parseQuietHours({ enabled: true, start: "08:00", end: "08:00" });
    expect(result).toMatchObject({ ok: false, field: "quietEnd" });
  });

  it("names the field that is wrong", () => {
    expect(parseQuietHours({ enabled: true, start: "", end: "07:00" })).toMatchObject({ ok: false, field: "quietStart" });
    expect(parseQuietHours({ enabled: true, start: "21:00", end: "25:00" })).toMatchObject({ ok: false, field: "quietEnd" });
  });

  it("gives values the learning rules read the same way", () => {
    const window = parseQuietHours({ enabled: true, start: "21:00", end: "07:00" });
    if (!window.ok) throw new Error("expected a window");
    const controls = { quietStartMin: window.startMin, quietEndMin: window.endMin };
    // January, so UK time is UTC.
    expect(inQuietHours(new Date("2027-01-12T22:30:00Z"), controls)).toBe(true);
    expect(inQuietHours(new Date("2027-01-12T06:59:00Z"), controls)).toBe(true);
    expect(inQuietHours(new Date("2027-01-12T07:00:00Z"), controls)).toBe(false);
    expect(inQuietHours(new Date("2027-01-12T16:00:00Z"), controls)).toBe(false);
    const off = parseQuietHours({ enabled: false, start: "21:00", end: "07:00" });
    if (!off.ok) throw new Error("expected off");
    expect(inQuietHours(new Date("2027-01-12T23:00:00Z"), { quietStartMin: off.startMin, quietEndMin: off.endMin })).toBe(false);
  });
});

describe("the controls form as a whole", () => {
  it("turns a valid form into controls", () => {
    const result = parseControlsForm(form({ dailyCap: "45", blockedCategories: [CATEGORY_SLUGS[0], CATEGORY_SLUGS[1]], blockedCourseIds: [COURSE_A], requireApprovalForPro: true }));
    expect(result).toEqual({ ok: true, value: { dailyMinutesCap: 45, quietStartMin: 1260, quietEndMin: 420, blockedCategories: [CATEGORY_SLUGS[0], CATEGORY_SLUGS[1]], blockedCourseIds: [COURSE_A], requireApprovalForPro: true } });
  });

  it("reports every problem at once, by field", () => {
    const result = parseControlsForm(form({ dailyCap: "2", quietStart: "nope", blockedCategories: ["not-a-subject"], blockedCourseIds: ["not-a-uuid"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors).sort()).toEqual(["blockedCategories", "blockedCourseIds", "dailyCap", "quietStart"]);
  });

  it("removes duplicates and normalises course ids", () => {
    const result = parseControlsForm(form({ blockedCategories: [CATEGORY_SLUGS[2], CATEGORY_SLUGS[2]], blockedCourseIds: [COURSE_A.toUpperCase(), COURSE_A, COURSE_B] }));
    expect(result.ok && result.value.blockedCategories).toEqual([CATEGORY_SLUGS[2]]);
    expect(result.ok && result.value.blockedCourseIds).toEqual([COURSE_A, COURSE_B]);
  });

  it("limits how many single courses can be blocked", () => {
    const ids = Array.from({ length: MAX_BLOCKED_COURSES + 1 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const result = parseControlsForm(form({ blockedCourseIds: ids }));
    expect(result.ok).toBe(false);
  });

  it("the service schema refuses what the form would refuse", () => {
    const good = { dailyMinutesCap: 60, quietStartMin: 1260, quietEndMin: 420, blockedCategories: [], blockedCourseIds: [], requireApprovalForPro: false };
    expect(controlsInputSchema.safeParse(good).success).toBe(true);
    expect(controlsInputSchema.safeParse({ ...good, dailyMinutesCap: null }).success).toBe(true);
    for (const bad of [
      { ...good, dailyMinutesCap: 0 },
      { ...good, dailyMinutesCap: 30.5 },
      { ...good, dailyMinutesCap: MAX_DAILY_CAP_MIN + 1 },
      { ...good, quietStartMin: 1440 },
      { ...good, quietEndMin: -1 },
      { ...good, blockedCategories: ["made-up"] },
      { ...good, blockedCourseIds: ["x"] },
      { ...good, paused: true },
    ]) {
      expect(controlsInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("pause reason", () => {
  it("is optional, trimmed and kept to one line", () => {
    expect(cleanPauseReason("")).toEqual({ ok: true, value: null });
    expect(cleanPauseReason("   ")).toEqual({ ok: true, value: null });
    expect(cleanPauseReason(undefined)).toEqual({ ok: true, value: null });
    expect(cleanPauseReason("  Homework first.\n\nBack on Friday  ")).toEqual({ ok: true, value: "Homework first. Back on Friday" });
  });

  it("refuses a reason that is too long", () => {
    expect(cleanPauseReason("a".repeat(MAX_PAUSE_REASON)).ok).toBe(true);
    expect(cleanPauseReason("a".repeat(MAX_PAUSE_REASON + 1)).ok).toBe(false);
  });
});

/** Reads a ZIP's central directory and inflates each entry, so the writer is checked against the format and not against itself. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(dataAt, dataAt + size);
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return files;
}

describe("export archive", () => {
  it("round-trips text and binary entries", () => {
    const picture = Buffer.from(Array.from({ length: 4000 }, (_, index) => (index * 31) % 251));
    const zip = buildZip(
      [
        { name: "README.txt", data: "Hello, Maya.\n".repeat(50) },
        { name: "files/p1/screenshot.png", data: picture, store: true },
        { name: "profile.json", data: '{"nickname":"Zoë"}' },
      ],
      new Date("2027-01-12T10:00:00Z"),
    );
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(["README.txt", "files/p1/screenshot.png", "profile.json"]);
    expect(files.get("README.txt")?.toString("utf8")).toBe("Hello, Maya.\n".repeat(50));
    expect(files.get("files/p1/screenshot.png")?.equals(picture)).toBe(true);
    expect(files.get("profile.json")?.toString("utf8")).toBe('{"nickname":"Zoë"}');
  });

  it("never writes a path that could escape the folder it is unpacked into", () => {
    expect(safeZipPath("../../etc/passwd")).toBe("etc/passwd");
    expect(safeZipPath("/absolute/path.txt")).toBe("absolute/path.txt");
    expect(safeZipPath("a\\..\\b.txt")).toBe("a/b.txt");
    expect(safeZipPath("..")).toBe("file");
    expect(safeZipPath("files/.hidden")).toBe("files/hidden");
    const files = readZip(buildZip([{ name: "../x.txt", data: "1" }, { name: "x.txt", data: "2" }], new Date("2027-01-12T10:00:00Z")));
    expect([...files.keys()]).toEqual(["x.txt", "x-2.txt"]);
  });
});
