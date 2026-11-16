import { env } from "@/env";
import { AppError } from "@/server/errors";
import { createLocalStorage } from "./local";
import { createS3Storage } from "./s3";
import type { ObjectInfo, Storage, StorageBucket } from "./types";

export * from "./keys";
export * from "./signing";
export * from "./types";
export { createLocalStorage } from "./local";
export { createS3Storage } from "./s3";

const globalForStorage = globalThis as typeof globalThis & {
  __platformStorage?: Partial<Record<StorageBucket, Storage>>;
};
const instances = (globalForStorage.__platformStorage ??= {});

/**
 * The storage chosen by `STORAGE_PROVIDER`. `private` (the default) holds learner uploads,
 * exports and anything personal; `public` holds course assets. Both are reached only through
 * signed links.
 */
export function getStorage(bucket: StorageBucket = "private"): Storage {
  return (instances[bucket] ??=
    env.STORAGE_PROVIDER === "s3" ? createS3Storage(bucket) : createLocalStorage(bucket));
}

/** Test helper: swap in a storage, or pass `undefined` to go back to the configured one. */
export function setStorage(bucket: StorageBucket, storage: Storage | undefined): void {
  if (storage) instances[bucket] = storage;
  else delete instances[bucket];
}

/**
 * Call when a browser says its signed upload has finished, before trusting the file. Confirms
 * the object exists and is within the size it was signed for, and deletes it if it is too big.
 * (The local driver refuses oversized uploads itself; S3 and R2 cannot, so this is the check.)
 */
export async function verifyUpload(
  key: string,
  limits: { maxBytes: number },
  storage: Storage = getStorage(),
): Promise<ObjectInfo> {
  const info = await storage.stat(key);
  if (!info) {
    throw new AppError("upload_rejected", "We couldn't find that upload. Try uploading the file again.", {
      detail: { reason: "missing" },
    });
  }
  if (info.size > limits.maxBytes) {
    await storage.delete(key);
    throw new AppError("upload_rejected", "That file is too big. Try a smaller file or a shorter clip.", {
      detail: { reason: "too_large", size: info.size },
    });
  }
  return info;
}
