/**
 * Regenerates `docs/SCHEMA.md` from the Drizzle schema.
 *
 *   pnpm exec tsx scripts/schema-doc.ts
 *
 * Run it after every schema change, alongside `pnpm db:generate`.
 */
import { writeFileSync } from "node:fs";
import { buildSchemaDoc } from "@/server/db/schema-doc";

writeFileSync("docs/SCHEMA.md", buildSchemaDoc(), "utf8");
console.info("docs/SCHEMA.md written.");
