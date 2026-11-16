/**
 * Object storage behind one interface: `local` (files under `.data/`, the default, so the app
 * runs with no account) and `s3` (AWS S3 eu-west-2, Cloudflare R2, or Supabase Storage's S3
 * endpoint). Everything is private: files are only ever reached through short-lived signed links.
 */
export type StorageBucket = "private" | "public";

export type StoredObject = { body: Buffer; contentType: string; size: number };
export type ObjectInfo = { contentType: string; size: number };

export type SignedDownloadOptions = {
  /** Seconds until the link stops working. Default 300 (5 minutes), at most 3600. */
  expiresInSec?: number;
  /** When given, the browser saves the file under this name instead of showing it. */
  downloadName?: string;
  /** The clock, for tests. */
  now?: Date;
};

export type SignedUploadOptions = {
  contentType: string;
  maxBytes: number;
  /** Default 300 (5 minutes), at most 3600. */
  expiresInSec?: number;
  now?: Date;
};

/** What the browser needs to upload: `PUT` the bytes to `url` with exactly these headers. */
export type SignedUpload = { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: Date };

export interface Storage {
  readonly driver: "local" | "s3";
  put(key: string, body: Buffer | Uint8Array | string, options: { contentType: string }): Promise<void>;
  /** `null` when there is no such object. */
  get(key: string): Promise<StoredObject | null>;
  /** Size and content type without reading the body. `null` when there is no such object. */
  stat(key: string): Promise<ObjectInfo | null>;
  /** Deleting something that is not there is not an error. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedDownloadUrl(key: string, options?: SignedDownloadOptions): Promise<string>;
  signedUploadUrl(key: string, options: SignedUploadOptions): Promise<SignedUpload>;
}

export const DEFAULT_SIGNED_URL_SEC = 300;
export const MAX_SIGNED_URL_SEC = 3600;

export function clampExpiry(expiresInSec: number | undefined): number {
  const value = expiresInSec ?? DEFAULT_SIGNED_URL_SEC;
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("expiresInSec must be a positive number of seconds");
  return Math.min(Math.floor(value), MAX_SIGNED_URL_SEC);
}
