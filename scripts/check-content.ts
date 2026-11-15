/**
 * `pnpm content:check` — checks everything under `content/` without a database.
 *
 * For every `content/courses/*.json`, `content/tools/*.json` and
 * `content/assets/*.json` it parses the file with its Zod schema, then runs
 * `validateCourse` on each course against the tools and assets found on disk
 * (with people screening off, as at launch). It prints a report grouped by
 * file and exits with code 1 if there is any error.
 *
 * Tools that nobody has verified yet (no under-18 policy, or not approved)
 * are reported as WARNINGS marked "to verify before publish", so courses can
 * be written before a person has checked the vendor's terms. Pass `--strict`
 * to make them errors, which is what must hold before anything is published.
 *
 * The functions are exported so the seed and import scripts, and the tests,
 * can load content the same way.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { z } from "zod";

import { assetManifestSchema, type ManifestAsset } from "../src/content/asset-schema";
import { courseSchema, type Course } from "../src/content/schema";
import { toolSeedSchema, type ToolSeed } from "../src/content/tool-schema";
import { validateCourse, type ValidationContext, type ValidationSeverity } from "../src/content/validate";

export interface ReportLine {
  severity: ValidationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface FileReport {
  /** Path relative to the repository root, with forward slashes. */
  file: string;
  kind: "course" | "tool" | "assets";
  lines: ReportLine[];
}

export interface LoadedContent {
  courses: Array<{ file: string; course: Course }>;
  tools: Array<{ file: string; tool: ToolSeed }>;
  assets: Array<{ file: string; asset: ManifestAsset }>;
  /** One report per file found, including files that failed to parse. */
  reports: FileReport[];
}

export interface ContentCheckResult {
  strict: boolean;
  reports: FileReport[];
  errors: number;
  warnings: number;
  counts: { courses: number; tools: number; assetManifests: number; assets: number };
}

/** Validator codes that mean "a person has not verified this tool yet". Warnings unless `--strict`. */
export const TOOL_TO_VERIFY_CODES: ReadonlySet<string> = new Set([
  "tool_policy_unverified",
  "tool_not_approved",
]);

export const TO_VERIFY_NOTE = "to verify before publish";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function jsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return []; // the folder does not exist yet
  }
}

function parseFile<T>(path: string, schema: z.ZodType<T>, report: FileReport): T | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    report.lines.push({
      severity: "error",
      code: "json_invalid",
      path: "",
      message: `This file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      report.lines.push({
        severity: "error",
        code: "schema",
        path: zodIssue.path.map(String).join("."),
        message: zodIssue.message,
      });
    }
    return undefined;
  }
  return parsed.data;
}

/** Reads and parses every content file. Never throws: problems are recorded in `reports`. */
export function loadContent(rootDir: string = REPO_ROOT): LoadedContent {
  const content: LoadedContent = { courses: [], tools: [], assets: [], reports: [] };
  const rel = (path: string): string => relative(rootDir, path).split("\\").join("/");

  for (const path of jsonFiles(join(rootDir, "content", "courses"))) {
    const report: FileReport = { file: rel(path), kind: "course", lines: [] };
    content.reports.push(report);
    const course = parseFile(path, courseSchema, report);
    if (!course) continue;
    if (course.slug !== basename(path, ".json")) {
      report.lines.push({
        severity: "error",
        code: "slug_filename_mismatch",
        path: "slug",
        message: `The slug "${course.slug}" does not match the file name. Name the file ${course.slug}.json.`,
      });
    }
    content.courses.push({ file: report.file, course });
  }

  for (const path of jsonFiles(join(rootDir, "content", "tools"))) {
    const report: FileReport = { file: rel(path), kind: "tool", lines: [] };
    content.reports.push(report);
    const tool = parseFile(path, toolSeedSchema, report);
    if (!tool) continue;
    if (tool.slug !== basename(path, ".json")) {
      report.lines.push({
        severity: "error",
        code: "slug_filename_mismatch",
        path: "slug",
        message: `The slug "${tool.slug}" does not match the file name. Name the file ${tool.slug}.json.`,
      });
    }
    content.tools.push({ file: report.file, tool });
  }

  const assetFiles = new Map<string, string>();
  for (const path of jsonFiles(join(rootDir, "content", "assets"))) {
    const report: FileReport = { file: rel(path), kind: "assets", lines: [] };
    content.reports.push(report);
    const manifest = parseFile(path, assetManifestSchema, report);
    if (!manifest) continue;
    manifest.forEach((asset, index) => {
      const firstFile = assetFiles.get(asset.id);
      if (firstFile !== undefined) {
        report.lines.push({
          severity: "error",
          code: "asset_duplicate",
          path: `${index}.id`,
          message: `The asset id "${asset.id}" is already defined in ${firstFile}.`,
        });
        return;
      }
      assetFiles.set(asset.id, report.file);
      content.assets.push({ file: report.file, asset });
    });
  }

  return content;
}

/** The validator's view of the Tool Register and asset list, built from the files on disk. */
export function buildValidationContext(content: LoadedContent): ValidationContext {
  return {
    tools: Object.fromEntries(
      content.tools.map(({ tool }) => [
        tool.slug,
        { under18Policy: tool.under18Policy, status: tool.seedStatus },
      ]),
    ),
    assets: Object.fromEntries(
      content.assets.map(({ asset }) => [
        asset.id,
        asset.altText === undefined ? { kind: asset.kind } : { kind: asset.kind, altText: asset.altText },
      ]),
    ),
    // No CSAM hash-matching provider is approved at launch (decision D3), so the real-people rule applies.
    peopleScreeningEnabled: false,
  };
}

export function runContentCheck(options: { rootDir?: string; strict?: boolean } = {}): ContentCheckResult {
  const strict = options.strict ?? false;
  const content = loadContent(options.rootDir);
  const context = buildValidationContext(content);
  const reportFor = (file: string): FileReport | undefined =>
    content.reports.find((report) => report.file === file);
  const toVerifySeverity: ValidationSeverity = strict ? "error" : "warning";

  for (const { file, tool } of content.tools) {
    const report = reportFor(file);
    if (!report) continue;
    if (tool.under18Policy === null) {
      report.lines.push({
        severity: toVerifySeverity,
        code: "tool_to_verify",
        path: "under18Policy",
        message: `"${tool.name}" has no under-18 policy yet: check the vendor's terms and record the decision — ${TO_VERIFY_NOTE}.`,
      });
    } else if (tool.toVerify || tool.seedStatus !== "approved") {
      report.lines.push({
        severity: toVerifySeverity,
        code: "tool_to_verify",
        path: "seedStatus",
        message: `"${tool.name}" has not been verified and approved (status: ${tool.seedStatus}) — ${TO_VERIFY_NOTE}.`,
      });
    }
  }

  const placeholdersByFile = new Map<string, number>();
  for (const { file, asset } of content.assets) {
    if (asset.placeholder) placeholdersByFile.set(file, (placeholdersByFile.get(file) ?? 0) + 1);
  }
  for (const [file, count] of placeholdersByFile) {
    reportFor(file)?.lines.push({
      severity: "warning",
      code: "asset_placeholder",
      path: "",
      message: `${count} placeholder ${count === 1 ? "asset" : "assets"}: replace with the real ${count === 1 ? "file" : "files"} before the course is published.`,
    });
  }

  for (const { file, course } of content.courses) {
    const report = reportFor(file);
    if (!report) continue;
    for (const found of validateCourse(course, context)) {
      const toVerify = TOOL_TO_VERIFY_CODES.has(found.code);
      report.lines.push({
        severity: toVerify ? toVerifySeverity : found.severity,
        code: found.code,
        path: found.path,
        message: toVerify ? `${found.message} (${TO_VERIFY_NOTE})` : found.message,
      });
    }
  }

  const lines = content.reports.flatMap((report) => report.lines);
  const errors = lines.filter((line) => line.severity === "error").length;
  return {
    strict,
    reports: content.reports,
    errors,
    warnings: lines.length - errors,
    counts: {
      courses: content.reports.filter((report) => report.kind === "course").length,
      tools: content.reports.filter((report) => report.kind === "tool").length,
      assetManifests: content.reports.filter((report) => report.kind === "assets").length,
      assets: content.assets.length,
    },
  };
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function formatReport(result: ContentCheckResult): string {
  const out: string[] = [];
  const { counts } = result;
  out.push(`Content check${result.strict ? " (strict)" : ""}`);
  out.push(
    `${count(counts.courses, "course")}, ${count(counts.tools, "tool")}, ${count(counts.assetManifests, "asset manifest")} (${count(counts.assets, "asset")})`,
  );
  if (result.reports.length === 0) out.push("", "No content files were found under content/.");

  for (const report of result.reports) {
    out.push("", report.file);
    if (report.lines.length === 0) {
      out.push("  OK");
      continue;
    }
    const sorted = [...report.lines].sort(
      (a, b) => Number(b.severity === "error") - Number(a.severity === "error"),
    );
    for (const line of sorted) {
      const label = line.severity === "error" ? "ERROR  " : "WARNING";
      out.push(`  ${label}  ${line.code}${line.path ? `  (${line.path})` : ""}`);
      out.push(`           ${line.message}`);
    }
  }

  out.push("");
  out.push(
    `Result: ${count(result.errors, "error")}, ${count(result.warnings, "warning")}. ${
      result.errors === 0 ? "Content check passed." : "Content check FAILED."
    }`,
  );
  if (!result.strict && result.errors === 0 && result.warnings > 0) {
    out.push(`Run with --strict to treat "${TO_VERIFY_NOTE}" items as errors, as they are at publish time.`);
  }
  return out.join("\n");
}

function main(argv: readonly string[]): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "Usage: pnpm content:check [--strict]\n\n  --strict  Treat tools that are still to verify as errors.",
    );
    return;
  }
  const unknown = argv.filter((arg) => arg !== "--strict");
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown.join(" ")}\nUsage: pnpm content:check [--strict]`);
    process.exitCode = 2;
    return;
  }
  const result = runContentCheck({ strict: argv.includes("--strict") });
  console.log(formatReport(result));
  process.exitCode = result.errors > 0 ? 1 : 0;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main(process.argv.slice(2));
}
