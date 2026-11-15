/**
 * Asset manifests: `content/assets/*.json`.
 *
 * Each file is an array of the spec's `Asset` (Section 6). An entry may also
 * be marked `placeholder: true` while the real file is still to be produced
 * (spec 6.2 allows placeholder videos until real ones are recorded).
 */
import { z } from "zod";

import { assetSchema } from "./schema";

export const manifestAssetSchema = assetSchema.extend({
  /** True while the stored file is a stand-in. Replace it before the course is published. */
  placeholder: z.literal(true).optional(),
});
export type ManifestAsset = z.infer<typeof manifestAssetSchema>;

export const assetManifestSchema = z.array(manifestAssetSchema).superRefine((assets, ctx) => {
  const seenIds = new Map<string, number>();
  const seenKeys = new Map<string, number>();
  assets.forEach((asset, index) => {
    const firstId = seenIds.get(asset.id);
    if (firstId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Asset id "${asset.id}" is already used by entry ${firstId}.`,
      });
    } else {
      seenIds.set(asset.id, index);
    }
    const firstKey = seenKeys.get(asset.storageKey);
    if (firstKey !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [index, "storageKey"],
        message: `Storage key "${asset.storageKey}" is already used by entry ${firstKey}.`,
      });
    } else {
      seenKeys.set(asset.storageKey, index);
    }
    if (asset.licence === "cc_by" && !asset.attribution?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: [index, "attribution"],
        message: "A CC BY asset needs an attribution.",
      });
    }
  });
});
export type AssetManifest = z.infer<typeof assetManifestSchema>;
