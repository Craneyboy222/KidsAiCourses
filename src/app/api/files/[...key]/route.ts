import { env } from "@/env";
import { AppError } from "@/server/errors";
import { handle, json } from "@/server/http";
import {
  baseContentType,
  downloadHeaders,
  getStorage,
  verifyLocalSignedRequest,
  type LocalSignedParams,
  type SignedOp,
} from "@/server/storage";

/**
 * Serves and accepts files for the LOCAL storage driver only. (With S3, R2 or Supabase the signed
 * links point straight at the storage provider and this route answers "not found".)
 *
 * There is no session check here on purpose: the signature is the permission. A link is made by a
 * service that has already checked who is asking, names one file and one operation, and runs out
 * after a few minutes.
 *
 * Files are never served as web pages: anything that is not an image, video, audio, PDF,
 * captions or plain text is sent as a download with a generic type, and `nosniff` stops the
 * browser guessing otherwise.
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string[] }> };

async function authorise(
  req: Request,
  context: RouteContext,
  expectedOp: SignedOp,
): Promise<LocalSignedParams> {
  if (env.STORAGE_PROVIDER !== "local") throw new AppError("not_found", "That file could not be found.");
  const { key } = await context.params;
  const result = verifyLocalSignedRequest({
    key: key.join("/"),
    query: new URL(req.url).searchParams,
    expectedOp,
    now: new Date(),
  });
  if (result.ok) return result.params;
  if (result.reason === "expired") {
    throw new AppError(
      "forbidden",
      "That link has run out. Go back to the page you came from and try again.",
      { detail: { reason: result.reason } },
    );
  }
  // The same answer for every other failure, so a guessed link learns nothing.
  throw new AppError("forbidden", "That link isn't valid. Go back to the page you came from and try again.", {
    detail: { reason: result.reason },
  });
}

/** `bytes=start-end` for one range. Anything else is ignored and the whole file is sent. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || size === 0) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return null;
  let start: number;
  let end: number;
  if (from === "") {
    start = Math.max(0, size - Number(to));
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

export const GET = handle(async (req: Request, context: RouteContext) => {
  const params = await authorise(req, context, "get");
  const object = await getStorage(params.bucket).get(params.key);
  if (!object) throw new AppError("not_found", "That file could not be found. It may have been removed.");

  const headers = new Headers(
    downloadHeaders({ key: params.key, contentType: object.contentType, downloadName: params.name }),
  );
  headers.set("Accept-Ranges", "bytes");
  // Video and audio players ask for a part of the file at a time.
  const range = parseRange(req.headers.get("range"), object.size);
  const bytes = range ? object.body.subarray(range.start, range.end + 1) : object.body;
  headers.set("Content-Length", String(bytes.byteLength));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${object.size}`);
  return new Response(new Uint8Array(bytes), { status: range ? 206 : 200, headers });
});

/** Reads the body, giving up as soon as it is larger than allowed, whatever `Content-Length` claimed. */
async function readCapped(req: Request, maxBytes: number): Promise<Buffer> {
  const tooBig = () =>
    new AppError("upload_rejected", "That file is too big. Try a smaller file or a shorter clip.", {
      status: 413,
      detail: { maxBytes },
    });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const PUT = handle(async (req: Request, context: RouteContext) => {
  const params = await authorise(req, context, "put");
  const maxBytes = params.maxBytes ?? 0;
  if (baseContentType(req.headers.get("content-type")) !== params.contentType) {
    throw new AppError(
      "upload_rejected",
      "That file isn't the type we were expecting. Choose the file again and retry.",
      {
        status: 415,
        detail: { expected: params.contentType },
      },
    );
  }
  const storage = getStorage(params.bucket);
  // A link uploads one file, once. It can never replace something that is already stored.
  if (await storage.exists(params.key)) {
    throw new AppError(
      "conflict",
      "That file has already been uploaded. If you need to change it, start a new upload.",
    );
  }
  const body = await readCapped(req, maxBytes);
  if (body.byteLength === 0)
    throw new AppError("upload_rejected", "That file was empty. Choose the file again and retry.");
  await storage.put(params.key, body, { contentType: params.contentType ?? "application/octet-stream" });
  return json({ ok: true, size: body.byteLength });
});
