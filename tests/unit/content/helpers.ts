/**
 * Shared fixtures for the content tests. Everything is built from the real
 * files under `content/`, so the tests fail if the flagship course drifts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assetManifestSchema } from "@/content/asset-schema";
import { findStep } from "@/content/course-utils";
import { courseSchema, type Course, type Lesson, type Quiz, type Step } from "@/content/schema";
import type { ValidationContext, ValidationIssue } from "@/content/validate";

export const REPO_ROOT = resolve(__dirname, "../../..");

export const SNAPCHAT_FILE = "content/courses/build-your-own-snapchat-style-app.json";

export function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), "utf8"));
}

/** A fresh, parsed copy of the Snapchat-style course. Safe to mutate. */
export function snapchatCourse(): Course {
  return courseSchema.parse(readJson(SNAPCHAT_FILE));
}

/**
 * A context in which the Snapchat course is publishable. The tool policies
 * are test fixtures, NOT facts about the real vendors: the real seed files
 * stay unverified until a person has read the vendors' terms.
 */
export function publishableContext(): ValidationContext {
  const assets = assetManifestSchema.parse(readJson("content/assets/snaplab.json"));
  return {
    tools: {
      replit: { under18Policy: "allowed", status: "approved" },
      base44: { under18Policy: "allowed", status: "approved" },
    },
    assets: Object.fromEntries(
      assets.map((asset) => [
        asset.id,
        asset.altText === undefined ? { kind: asset.kind } : { kind: asset.kind, altText: asset.altText },
      ]),
    ),
    peopleScreeningEnabled: false,
  };
}

export function stepOf(course: Course, stepId: string): Step {
  const found = findStep(course, stepId);
  if (!found) throw new Error(`No step ${stepId} in the fixture`);
  return found.step;
}

export function lessonOf(course: Course, lessonId: string): Lesson {
  for (const mod of course.modules) {
    const lesson = mod.lessons.find((candidate) => candidate.id === lessonId);
    if (lesson) return lesson;
  }
  throw new Error(`No lesson ${lessonId} in the fixture`);
}

export function configOf(course: Course, stepId: string): Record<string, unknown> {
  const step = stepOf(course, stepId);
  step.config ??= {};
  return step.config;
}

export function firstQuiz(course: Course): Quiz {
  const quiz = course.quizzes[0];
  if (!quiz) throw new Error("The fixture has no quiz");
  return quiz;
}

/** Array access that fails loudly instead of returning undefined. */
export function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`Nothing at index ${index}`);
  return item;
}

export const codesOf = (issues: readonly ValidationIssue[]): string[] => issues.map((issue) => issue.code);

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
