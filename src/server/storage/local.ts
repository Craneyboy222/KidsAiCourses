import { mkdir, readFile, rm, stat as fsStat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/env";
import { baseContentType, resolveKeyPath } from "./keys";
import { buildLocalSignedPath } from "./signing";
import {
  clampExpiry,
  type ObjectInfo,
  type SignedDownloadOptions,
  type SignedUpload,
  type SignedUploadOptions,
  type Storage,
  type StorageBucket,
  type StoredObject,
} from "./types";

/**
 * Files on disk under `STORAGE_LOCAL_DIR/<bucket>/`: the bytes in `objects/<key>` and the content
 * type in `meta/<key>.json`, so no key can collide with another key's metadata. For local
 * development, tests and single-server installs. Signed links point at `/api/files/...` on our
 * own site, which checks the signature and serves the file.
 */
const isMissing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: unknown }).code === "ENOENT";

export function createLocalStorage(
  bucket: StorageBucket,
  options: { rootDir?: string; baseUrl?: string } = {},
): Storage {
  const bucketName = bucket === "public" ? env.STORAGE_BUCKET_PUBLIC : env.STORAGE_BUCKET_PRIVATE;
  const root = () =>
    path.resolve(options.rootDir ?? env.STORAGE_LOCAL_DIR, bucketName.replace(/[^A-Za-z0-9._-]/g, "_"));
  const objectPath = (key: string) => resolveKeyPath(path.join(root(), "objects"), key);
  const metaPath = (key: string) => `${resolveKeyPath(path.join(root(), "meta"), key)}.json`;
  const origin = () => (options.baseUrl ?? env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, "");

  async function readMeta(key: string): Promise<string> {
    try {
      const parsed: unknown = JSON.parse(await readFile(metaPath(key), "utf8"));
      const type =
        typeof parsed === "object" && parsed !== null && "contentType" in parsed
          ? (parsed as { contentType: unknown }).contentType
          : null;
      return typeof type === "string" && type.length > 0 ? type : "application/octet-stream";
    } catch {
      return "application/octet-stream";
    }
  }

  async function stat(key: string): Promise<ObjectInfo | null> {
    try {
      const info = await fsStat(objectPath(key));
      if (!info.isFile()) return null;
      return { size: info.size, contentType: await readMeta(key) };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  return {
    driver: "local",

    async put(key, body, { contentType }) {
      const target = objectPath(key);
      const meta = metaPath(key);
      await mkdir(path.dirname(target), { recursive: true });
      await mkdir(path.dirname(meta), { recursive: true });
      // Write beside the target and rename, so a reader never sees half a file.
      const temporary = `${target}.${randomUUID()}.part`;
      await writeFile(temporary, body);
      await rename(temporary, target);
      await writeFile(
        meta,
        JSON.stringify({ contentType: baseContentType(contentType) || "application/octet-stream" }),
      );
    },

    async get(key): Promise<StoredObject | null> {
      try {
        const body = await readFile(objectPath(key));
        return { body, size: body.byteLength, contentType: await readMeta(key) };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    stat,

    async delete(key) {
      await rm(objectPath(key), { force: true });
      await rm(metaPath(key), { force: true });
    },

    async exists(key) {
      return (await stat(key)) !== null;
    },

    async signedDownloadUrl(key, opts: SignedDownloadOptions = {}) {
      resolveKeyPath(root(), key);
      const exp = Math.floor((opts.now ?? new Date()).getTime() / 1000) + clampExpiry(opts.expiresInSec);
      return `${origin()}${buildLocalSignedPath({ op: "get", bucket, key, exp, ...(opts.downloadName ? { name: opts.downloadName } : {}) })}`;
    },

    async signedUploadUrl(key, opts: SignedUploadOptions): Promise<SignedUpload> {
      resolveKeyPath(root(), key);
      if (!Number.isInteger(opts.maxBytes) || opts.maxBytes < 1)
        throw new Error("maxBytes must be a whole number of at least 1");
      const contentType = baseContentType(opts.contentType);
      if (!contentType) throw new Error("contentType is required for a signed upload");
      const now = opts.now ?? new Date();
      const exp = Math.floor(now.getTime() / 1000) + clampExpiry(opts.expiresInSec);
      return {
        url: `${origin()}${buildLocalSignedPath({ op: "put", bucket, key, exp, contentType, maxBytes: opts.maxBytes })}`,
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresAt: new Date(exp * 1000),
      };
    },
  };
}
