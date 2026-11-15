import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildValidationContext,
  formatReport,
  loadContent,
  runContentCheck,
} from "../../../scripts/check-content";

import { REPO_ROOT, SNAPCHAT_FILE } from "./helpers";

const tempDirs: string[] = [];

const SNAPCHAT_CONTENT = [
  SNAPCHAT_FILE,
  "content/tools/replit.json",
  "content/tools/base44.json",
  "content/assets/snaplab.json",
];

/**
 * A scratch copy of the Snapchat course and the files it depends on, which a
 * test can break without touching the real content (or being affected by
 * courses other people add later).
 */
function scratchContent(): string {
  const root = mkdtempSync(join(tmpdir(), "content-check-"));
  tempDirs.push(root);
  for (const folder of ["courses", "tools", "assets"])
    mkdirSync(join(root, "content", folder), { recursive: true });
  for (const file of SNAPCHAT_CONTENT) cpSync(join(REPO_ROOT, file), join(root, file));
  return root;
}

function editJson(root: string, file: string, edit: (data: Record<string, unknown>) => void): void {
  const path = join(root, file);
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pnpm content:check", () => {
  it("passes the real content with no errors", () => {
    const result = runContentCheck();
    expect(result.errors).toBe(0);
    expect(result.counts.courses).toBeGreaterThanOrEqual(1);
    expect(result.reports.map((report) => report.file)).toContain(SNAPCHAT_FILE);
    expect(formatReport(result)).toContain("Content check passed.");
  });

  it("reports unverified tools as warnings marked 'to verify before publish'", () => {
    const result = runContentCheck({ rootDir: scratchContent() });
    expect(result.errors).toBe(0);
    const course = result.reports.find((report) => report.file === SNAPCHAT_FILE);
    expect(course?.lines).toEqual([
      expect.objectContaining({ code: "tool_policy_unverified", severity: "warning" }),
    ]);
    expect(course?.lines[0]?.message).toContain("to verify before publish");
    const replit = result.reports.find((report) => report.file === "content/tools/replit.json");
    expect(replit?.lines).toEqual([
      expect.objectContaining({
        code: "tool_to_verify",
        severity: "warning",
        message: expect.stringContaining("to verify before publish"),
      }),
    ]);
  });

  it("makes them errors with --strict", () => {
    const result = runContentCheck({ rootDir: scratchContent(), strict: true });
    expect(result.errors).toBe(3);
    const codes = result.reports.flatMap((report) =>
      report.lines.filter((line) => line.severity === "error").map((line) => line.code),
    );
    expect(codes.sort()).toEqual(["tool_policy_unverified", "tool_to_verify", "tool_to_verify"]);
    expect(formatReport(result)).toContain("Content check FAILED.");
  });

  it("builds the validation context from the tool and asset files, with people screening off", () => {
    const context = buildValidationContext(loadContent());
    expect(context.peopleScreeningEnabled).toBe(false);
    expect(context.tools.replit).toEqual({ under18Policy: null, status: "pending_verification" });
    expect(context.assets["img-snaplab-sample"]?.kind).toBe("image");
    expect(context.assets["img-snaplab-sample"]?.altText).toBeTruthy();
    expect(context.assets["vid-snaplab-trailer"]).toEqual({ kind: "video" });
  });

  it("fails a course that asks for a selfie", () => {
    const root = scratchContent();
    editJson(root, SNAPCHAT_FILE, (course) => {
      (course.projectBrief as { deliverables: string[] }).deliverables.push(
        "A selfie with your best filter on",
      );
    });
    const result = runContentCheck({ rootDir: root });
    expect(result.errors).toBe(1);
    const report = formatReport(result);
    expect(report).toContain("ERROR    evidence_requires_real_people  (projectBrief.deliverables.6)");
    expect(report).toContain("Content check FAILED.");
  });

  it("fails a file that does not fit its schema, and says where", () => {
    const root = scratchContent();
    editJson(root, SNAPCHAT_FILE, (course) => {
      course.minAge = 12;
    });
    const result = runContentCheck({ rootDir: root });
    expect(result.reports.find((report) => report.file === SNAPCHAT_FILE)?.lines).toEqual([
      expect.objectContaining({ severity: "error", code: "schema", path: "minAge" }),
    ]);
  });

  it("fails broken JSON, a slug that does not match its file name, and an asset defined twice", () => {
    const root = scratchContent();
    writeFileSync(join(root, "content/courses/broken.json"), "{ not json");
    cpSync(join(root, "content/tools/replit.json"), join(root, "content/tools/replit-copy.json"));
    cpSync(join(root, "content/assets/snaplab.json"), join(root, "content/assets/snaplab-again.json"));
    const result = runContentCheck({ rootDir: root });
    const errorCodes = (file: string): string[] =>
      result.reports
        .find((report) => report.file === file)
        ?.lines.filter((line) => line.severity === "error")
        .map((line) => line.code) ?? [];
    expect(errorCodes("content/courses/broken.json")).toEqual(["json_invalid"]);
    expect(errorCodes("content/tools/replit-copy.json")).toEqual(["slug_filename_mismatch"]);
    expect(
      new Set(errorCodes("content/assets/snaplab.json")).size +
        new Set(errorCodes("content/assets/snaplab-again.json")).size,
    ).toBe(1);
    expect(result.errors).toBeGreaterThanOrEqual(7);
  });

  it("fails a course whose asset is missing from the manifests", () => {
    const root = scratchContent();
    writeFileSync(join(root, "content/assets/snaplab.json"), "[]");
    const result = runContentCheck({ rootDir: root });
    const codes =
      result.reports.find((report) => report.file === SNAPCHAT_FILE)?.lines.map((line) => line.code) ?? [];
    expect(codes).toContain("asset_missing");
    expect(result.errors).toBeGreaterThan(0);
  });

  it("reports an empty content folder without failing", () => {
    const root = mkdtempSync(join(tmpdir(), "content-check-empty-"));
    tempDirs.push(root);
    const result = runContentCheck({ rootDir: root });
    expect(result).toMatchObject({ errors: 0, warnings: 0, reports: [] });
    expect(formatReport(result)).toContain("No content files were found");
  });
});
