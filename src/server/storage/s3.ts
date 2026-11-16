import { env } from "@/env";
import {
  assertStorageKey,
  baseContentType,
  contentDisposition,
  isInlineSafeType,
  servedContentType,
} from "./keys";
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
 * S3-compatible storage with AWS SDK v3. Works with:
 * - AWS S3 in London: `STORAGE_S3_REGION=eu-west-2`, no endpoint.
 * - Cloudflare R2: `STORAGE_S3_ENDPOINT=https://<account>.eu.r2.cloudflarestorage.com`, region `auto`.
 * - Supabase Storage: `STORAGE_S3_ENDPOINT=https://<project>.supabase.co/storage/v1/s3` (or just
 *   `SUPABASE_URL`), the project's region, and S3 access keys made in the Supabase dashboard.
 *
 * Buckets must be private. Objects are stored with a content type that is safe to serve, and
 * anything a browser must not display (HTML, SVG, unknown types) is stored as a download, so a
 * signed link can never run a file as a page. The original type is kept in object metadata.
 *
 * The SDK is imported on first use, so the local driver never loads it.
 *
 * Limit to know about: a signed PUT cannot cap the upload size on S3 or R2. Whoever completes an
 * upload must call `verifyUpload()` (in `index.ts`), which checks the size and deletes anything
 * too large.
 */
const ORIGINAL_TYPE_META = "original-content-type";

type S3Module = typeof import("@aws-sdk/client-s3");
type S3Client = InstanceType<S3Module["S3Client"]>;

let sdk: Promise<S3Module> | undefined;
let client: Promise<S3Client> | undefined;

function endpoint(): string | undefined {
  if (env.STORAGE_S3_ENDPOINT) return env.STORAGE_S3_ENDPOINT;
  if (env.SUPABASE_URL) return `${env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/s3`;
  return undefined;
}

async function getClient(): Promise<{ s3: S3Module; client: S3Client }> {
  sdk ??= import("@aws-sdk/client-s3");
  const s3 = await sdk;
  client ??= Promise.resolve().then(() => {
    const accessKeyId = env.STORAGE_S3_ACCESS_KEY_ID;
    const secretAccessKey = env.STORAGE_S3_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("STORAGE_PROVIDER=s3 needs STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY");
    }
    const custom = endpoint();
    return new s3.S3Client({
      region: env.STORAGE_S3_REGION,
      credentials: { accessKeyId, secretAccessKey },
      // R2 and Supabase are addressed as endpoint/bucket/key rather than bucket.endpoint/key.
      ...(custom ? { endpoint: custom, forcePathStyle: true } : {}),
    });
  });
  return { s3, client: await client };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

/** How an object of this type is stored: what the browser will be told, and what it really was. */
function objectHeaders(contentType: string, key: string) {
  const original = baseContentType(contentType) || "application/octet-stream";
  return {
    ContentType: servedContentType(original),
    ...(isInlineSafeType(original)
      ? {}
      : { ContentDisposition: contentDisposition("attachment", key.split("/").pop() ?? "download") }),
    Metadata: { [ORIGINAL_TYPE_META]: original },
  };
}

export function createS3Storage(bucket: StorageBucket): Storage {
  const Bucket = bucket === "public" ? env.STORAGE_BUCKET_PUBLIC : env.STORAGE_BUCKET_PRIVATE;

  async function stat(key: string): Promise<ObjectInfo | null> {
    assertStorageKey(key);
    const { s3, client: c } = await getClient();
    try {
      const head = await c.send(new s3.HeadObjectCommand({ Bucket, Key: key }));
      return {
        size: head.ContentLength ?? 0,
        contentType: head.Metadata?.[ORIGINAL_TYPE_META] ?? head.ContentType ?? "application/octet-stream",
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  return {
    driver: "s3",

    async put(key, body, { contentType }) {
      assertStorageKey(key);
      const { s3, client: c } = await getClient();
      await c.send(
        new s3.PutObjectCommand({
          Bucket,
          Key: key,
          Body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
          ...objectHeaders(contentType, key),
        }),
      );
    },

    async get(key): Promise<StoredObject | null> {
      assertStorageKey(key);
      const { s3, client: c } = await getClient();
      try {
        const out = await c.send(new s3.GetObjectCommand({ Bucket, Key: key }));
        if (!out.Body) return null;
        const body = Buffer.from(await out.Body.transformToByteArray());
        return {
          body,
          size: body.byteLength,
          contentType: out.Metadata?.[ORIGINAL_TYPE_META] ?? out.ContentType ?? "application/octet-stream",
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    stat,

    async delete(key) {
      assertStorageKey(key);
      const { s3, client: c } = await getClient();
      await c.send(new s3.DeleteObjectCommand({ Bucket, Key: key }));
    },

    async exists(key) {
      return (await stat(key)) !== null;
    },

    async signedDownloadUrl(key, opts: SignedDownloadOptions = {}) {
      assertStorageKey(key);
      const { s3, client: c } = await getClient();
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const command = new s3.GetObjectCommand({
        Bucket,
        Key: key,
        ...(opts.downloadName
          ? { ResponseContentDisposition: contentDisposition("attachment", opts.downloadName) }
          : {}),
      });
      return getSignedUrl(c, command, {
        expiresIn: clampExpiry(opts.expiresInSec),
        ...(opts.now ? { signingDate: opts.now } : {}),
      });
    },

    async signedUploadUrl(key, opts: SignedUploadOptions): Promise<SignedUpload> {
      assertStorageKey(key);
      if (!Number.isInteger(opts.maxBytes) || opts.maxBytes < 1)
        throw new Error("maxBytes must be a whole number of at least 1");
      const { s3, client: c } = await getClient();
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const stored = objectHeaders(opts.contentType, key);
      const expiresIn = clampExpiry(opts.expiresInSec);
      const now = opts.now ?? new Date();
      const url = await getSignedUrl(c, new s3.PutObjectCommand({ Bucket, Key: key, ...stored }), {
        expiresIn,
        signingDate: now,
        // The browser must send exactly these, or the signature fails.
        signableHeaders: new Set(["content-type", "content-disposition"]),
      });
      return {
        url,
        method: "PUT",
        headers: {
          "Content-Type": stored.ContentType,
          ...("ContentDisposition" in stored ? { "Content-Disposition": stored.ContentDisposition } : {}),
        },
        expiresAt: new Date(now.getTime() + expiresIn * 1000),
      };
    },
  };
}
