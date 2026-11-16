import { sign, verifySignature } from "@/server/crypto";
import { isValidStorageKey } from "./keys";
import type { StorageBucket } from "./types";

/**
 * Signed links for the local storage driver. A link is a path on our own site,
 * `/api/files/<key>?op=…&b=…&exp=…[&name=…][&ct=…&max=…]&sig=…`, where `sig` is an HMAC over
 * every other part. Change any part (the key, the expiry, the size limit) and the signature no
 * longer matches. Pure functions apart from the HMAC key, which comes from the environment.
 */
export type SignedOp = "get" | "put";

export type LocalSignedParams = {
  op: SignedOp;
  bucket: StorageBucket;
  key: string;
  /** Unix seconds after which the link is dead. */
  exp: number;
  /** Download name (`get`). */
  name?: string;
  /** Required content type (`put`). */
  contentType?: string;
  /** Largest body accepted, in bytes (`put`). */
  maxBytes?: number;
};

export const FILES_ROUTE = "/api/files";

function payload(p: LocalSignedParams): string {
  // Newline-separated, with every field always present, so no two different links share a payload.
  return [
    "v1",
    p.op,
    p.bucket,
    p.key,
    String(p.exp),
    p.name ?? "",
    p.contentType ?? "",
    p.maxBytes === undefined ? "" : String(p.maxBytes),
  ].join("\n");
}

export function signLocalParams(params: LocalSignedParams): string {
  return sign(payload(params));
}

/** The path and query of a signed link (no origin). */
export function buildLocalSignedPath(params: LocalSignedParams): string {
  const query = new URLSearchParams({ op: params.op, b: params.bucket, exp: String(params.exp) });
  if (params.name !== undefined) query.set("name", params.name);
  if (params.contentType !== undefined) query.set("ct", params.contentType);
  if (params.maxBytes !== undefined) query.set("max", String(params.maxBytes));
  query.set("sig", signLocalParams(params));
  const encodedKey = params.key.split("/").map(encodeURIComponent).join("/");
  return `${FILES_ROUTE}/${encodedKey}?${query.toString()}`;
}

export type VerifyFailure = "malformed" | "bad_signature" | "expired" | "wrong_operation";
export type VerifyResult = { ok: true; params: LocalSignedParams } | { ok: false; reason: VerifyFailure };

const wholeNumber = (value: string | null): number | null =>
  value !== null && /^\d{1,15}$/.test(value) ? Number(value) : null;

/**
 * Checks a request against its signature. `key` comes from the URL path, the rest from the
 * query string. The signature is checked before the expiry, in constant time, so a forged link
 * learns nothing from the answer.
 */
export function verifyLocalSignedRequest(input: {
  key: string;
  query: URLSearchParams;
  expectedOp: SignedOp;
  now: Date;
}): VerifyResult {
  const { key, query } = input;
  const op = query.get("op");
  const bucket = query.get("b");
  const exp = wholeNumber(query.get("exp"));
  const sig = query.get("sig");
  if (
    (op !== "get" && op !== "put") ||
    (bucket !== "private" && bucket !== "public") ||
    exp === null ||
    !sig ||
    !isValidStorageKey(key)
  ) {
    return { ok: false, reason: "malformed" };
  }
  const maxRaw = query.get("max");
  const maxBytes = maxRaw === null ? undefined : wholeNumber(maxRaw);
  if (maxBytes === null) return { ok: false, reason: "malformed" };
  const params: LocalSignedParams = {
    op,
    bucket,
    key,
    exp,
    ...(query.has("name") ? { name: query.get("name") ?? "" } : {}),
    ...(query.has("ct") ? { contentType: query.get("ct") ?? "" } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
  };
  if (!verifySignature(payload(params), sig)) return { ok: false, reason: "bad_signature" };
  if (op !== input.expectedOp) return { ok: false, reason: "wrong_operation" };
  if (input.now.getTime() >= exp * 1000) return { ok: false, reason: "expired" };
  if (op === "put" && (params.contentType === undefined || params.maxBytes === undefined))
    return { ok: false, reason: "malformed" };
  return { ok: true, params };
}
