import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { AppError } from "@/server/errors";

/**
 * Outbound-request safety (SSRF). Used for every URL that comes from a learner
 * (evidence links) and for every Radar and enrichment fetch (spec Sections 3.4, 6.3, 16).
 *
 * Rules: HTTPS only, default port only, no credentials in the URL, and the host must
 * resolve only to public addresses. Redirects are followed manually and re-checked.
 */
export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

const BLOCKED_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp|.*\.intranet|metadata\.google\.internal)$/i;

/** True only for addresses on the public internet. */
export function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return isPublicAddress(v6.toIPv4Address().toString());
  }
  // `unicast` is the only range ipaddr.js gives to ordinary public addresses; everything else
  // (private, loopback, linkLocal, uniqueLocal, carrierGradeNat, multicast, reserved, …) is refused.
  return parsed.range() === "unicast";
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Structural checks that need no network access. */
export function checkUrlShape(input: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "That doesn't look like a full web address. It should start with https://" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Links need to start with https://" };
  if (url.username || url.password) return { ok: false, reason: "Links can't include a username or password." };
  if (url.port && url.port !== "443") return { ok: false, reason: "Links can't use an unusual port number." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || BLOCKED_HOSTNAMES.test(host)) return { ok: false, reason: "That address isn't on the public internet." };
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) return { ok: false, reason: "That address isn't on the public internet." };
  } else if (!host.includes(".")) {
    return { ok: false, reason: "That address isn't on the public internet." };
  }
  return { ok: true, url };
}

/** Full check: shape, then DNS. Every resolved address must be public. */
export async function checkPublicUrl(input: string, resolver: Resolver = defaultResolver): Promise<UrlCheck> {
  const shape = checkUrlShape(input);
  if (!shape.ok) return shape;
  const host = shape.url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) return shape;
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    return { ok: false, reason: "We couldn't find that website. Check the link and try again." };
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    return { ok: false, reason: "That address isn't on the public internet." };
  }
  return shape;
}

export async function assertPublicUrl(input: string, resolver?: Resolver): Promise<URL> {
  const result = await checkPublicUrl(input, resolver);
  if (!result.ok) throw new AppError("unsafe_url", result.reason);
  return result.url;
}

export type SafeFetchOptions = {
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  resolver?: Resolver;
  fetchImpl?: typeof fetch;
};
export type SafeFetchResult = { url: string; status: number; contentType: string; text: string; truncated: boolean };

/** GET a public HTTPS page as text, with size and time limits. Never sends cookies or credentials. */
export async function safeFetchText(input: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const { timeoutMs = 10_000, maxBytes = 1_000_000, maxRedirects = 3, fetchImpl = fetch } = opts;
  let current = await assertPublicUrl(input, opts.resolver);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,text/plain;q=0.8", ...(opts.userAgent ? { "user-agent": opts.userAgent } : {}), ...opts.headers },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new AppError("unsafe_url", "That link redirected somewhere we couldn't follow.");
      current = await assertPublicUrl(new URL(location, current).toString(), opts.resolver);
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          truncated = true;
          chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return {
      url: current.toString(),
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      text: Buffer.concat(chunks).toString("utf8"),
      truncated,
    };
  }
  throw new AppError("unsafe_url", "That link redirected too many times.");
}
