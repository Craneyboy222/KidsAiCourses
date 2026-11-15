/**
 * Tool Register seed files: `content/tools/*.json` (spec 3.3 and Section 15).
 *
 * A seed file may be written before anyone has checked the vendor's terms.
 * In that state the facts that need checking are `null` and `toVerify` is
 * true. Age rules, prices and terms are never filled in from memory: a person
 * reads the live vendor pages and records what they found in `evidence`
 * (spec Section 17, question 4).
 */
import { z } from "zod";

import { isoDateSchema, slugSchema, under18PolicySchema } from "./schema";

export const TOOL_SEED_STATUSES = ["candidate", "pending_verification", "approved"] as const;
export const toolSeedStatusSchema = z.enum(TOOL_SEED_STATUSES);
export type ToolSeedStatus = z.infer<typeof toolSeedStatusSchema>;

const httpsUrl = z.url({ protocol: /^https$/, error: "Use a full https:// address." });

export const toolEvidenceSchema = z.strictObject({
  /** What was checked, for example "Minimum age in the terms of service". */
  claim: z.string().trim().min(1),
  /** The vendor's own words, copied from the page. */
  quote: z.string().trim().min(1).optional(),
  url: httpsUrl,
});
export type ToolEvidence = z.infer<typeof toolEvidenceSchema>;

export const toolCostSchema = z.strictObject({
  /** What the free tier includes, in plain words. `null` until verified. */
  freeTier: z.string().trim().min(1).nullable(),
  /** What a parent would pay and for what, if anything. `null` until verified. */
  paidNote: z.string().trim().min(1).nullable(),
});
export type ToolCost = z.infer<typeof toolCostSchema>;

export const toolSeedSchema = z
  .strictObject({
    slug: slugSchema,
    name: z.string().trim().min(1),
    /** Registrable domain, lower case, no scheme: `replit.com`. Used to de-duplicate Radar candidates. */
    vendorDomain: z
      .string()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, "Use a bare domain such as example.com."),
    officialUrl: httpsUrl,
    /** Links to the tool must start with one of these (the allow-list behind `<ExternalToolLink>`). */
    allowedUrlPrefixes: z.array(httpsUrl).min(1),
    cost: toolCostSchema,
    /** Minimum age under the vendor's terms. `null` until verified. */
    minAge: z.number().int().min(0).max(21).nullable(),
    /** What the vendor's terms say about parental consent. `null` until verified. */
    consentRule: z.string().trim().min(1).nullable(),
    /** `null` until a reviewer has read the terms and recorded a decision. */
    under18Policy: under18PolicySchema.nullable(),
    notes: z.string(),
    seedStatus: toolSeedStatusSchema,
    /** When a person last checked the vendor pages. `null` if never. */
    lastCheckedAt: isoDateSchema.nullable(),
    evidence: z.array(toolEvidenceSchema),
    toVerify: z.boolean(),
  })
  .superRefine((tool, ctx) => {
    const onVendorDomain = (value: string): boolean => {
      const host = new URL(value).hostname.toLowerCase();
      return host === tool.vendorDomain || host.endsWith(`.${tool.vendorDomain}`);
    };
    if (!onVendorDomain(tool.officialUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["officialUrl"],
        message: "The official link must be on the vendor domain.",
      });
    }
    tool.allowedUrlPrefixes.forEach((prefix, index) => {
      if (!onVendorDomain(prefix)) {
        ctx.addIssue({
          code: "custom",
          path: ["allowedUrlPrefixes", index],
          message: "Allowed link prefixes must be on the vendor domain.",
        });
      }
      // "https://replit.com" would also match "https://replit.com.evil.example", so a prefix must end the host.
      if (new URL(prefix).pathname === "/" && !prefix.endsWith("/")) {
        ctx.addIssue({
          code: "custom",
          path: ["allowedUrlPrefixes", index],
          message: 'End the prefix with "/" so it cannot match another domain.',
        });
      }
    });
    if (!tool.allowedUrlPrefixes.some((prefix) => tool.officialUrl.startsWith(prefix))) {
      ctx.addIssue({
        code: "custom",
        path: ["officialUrl"],
        message: "The official link must start with one of the allowed link prefixes.",
      });
    }
    if (tool.seedStatus === "approved") {
      if (tool.under18Policy === null) {
        ctx.addIssue({
          code: "custom",
          path: ["under18Policy"],
          message: "An approved tool needs an under-18 policy.",
        });
      }
      if (tool.lastCheckedAt === null) {
        ctx.addIssue({
          code: "custom",
          path: ["lastCheckedAt"],
          message: "An approved tool needs a last-checked date.",
        });
      }
      if (tool.toVerify) {
        ctx.addIssue({
          code: "custom",
          path: ["toVerify"],
          message: "An approved tool cannot still be marked to verify.",
        });
      }
      if (tool.evidence.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["evidence"],
          message: "An approved tool needs at least one piece of evidence from the vendor's pages.",
        });
      }
    }
  });
export type ToolSeed = z.infer<typeof toolSeedSchema>;
