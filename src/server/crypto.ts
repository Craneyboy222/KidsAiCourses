import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

/**
 * Application-level encryption (AES-256-GCM) for safeguarding notes and tutor messages,
 * on top of encryption at rest. Output format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */
export type KeyName = "safeguarding" | "content";

function key(name: KeyName): Buffer {
  const raw = name === "safeguarding" ? env.SAFEGUARDING_ENCRYPTION_KEY : env.CONTENT_ENCRYPTION_KEY;
  // Accept 64 hex characters or any long passphrase (hashed down to 32 bytes).
  return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : createHash("sha256").update(raw).digest();
}

export function encrypt(plain: string, keyName: KeyName): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyName), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(sealed: string, keyName: KeyName): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Unrecognised ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key(keyName), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** A URL-safe random token. Store only `hashToken(token)`. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
/** Short human-typeable code, e.g. for invite codes: no 0/O/1/I/L. */
export function newCode(length = 8): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
/** Signs a value with the auth secret, for stateless links (e.g. local signed download URLs). */
export function sign(value: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(value).digest("base64url");
}
export function verifySignature(value: string, signature: string): boolean {
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
