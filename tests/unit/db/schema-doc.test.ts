import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSchemaDoc } from "@/server/db/schema-doc";

describe("docs/SCHEMA.md", () => {
  it("matches the Drizzle schema (regenerate with `pnpm exec tsx scripts/schema-doc.ts`)", () => {
    expect(readFileSync("docs/SCHEMA.md", "utf8")).toBe(buildSchemaDoc());
  });

  it("lists every table once", () => {
    const doc = buildSchemaDoc();
    const names = [...doc.matchAll(/^- \*\*([a-z_0-9]+)\*\*.*?: id uuid pk/gm)].map((m) => m[1]);
    expect(names.length).toBe(90);
    expect(new Set(names).size).toBe(90);
  });
});
