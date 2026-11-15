import { describe, expect, it } from "vitest";
import { checkPublicUrl, checkUrlShape, isPublicAddress, safeFetchText, type Resolver } from "@/server/net/safe-fetch";

const resolveTo =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses;

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])("%s is public", (a) => expect(isPublicAddress(a)).toBe(true));
  it.each([
    "127.0.0.1", "10.0.0.5", "172.16.4.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip",
  ])("%s is refused", (a) => expect(isPublicAddress(a)).toBe(false));
});

describe("checkUrlShape", () => {
  it("accepts a normal https link", () => {
    expect(checkUrlShape("https://replit.com/@nickname/snaplab").ok).toBe(true);
  });
  it.each([
    "http://example.com",
    "ftp://example.com/file",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "https://example.com:8443/",
    "https://localhost/admin",
    "https://app.localhost/",
    "https://printer.local/",
    "https://intranet/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://169.254.169.254/latest/meta-data/",
    "https://192.168.0.10/",
    "https://metadata.google.internal/",
    "not a url",
    "",
  ])("refuses %s", (u) => expect(checkUrlShape(u).ok).toBe(false));
  it("explains what to try", () => {
    const r = checkUrlShape("http://example.com");
    expect(r.ok === false && r.reason).toMatch(/https/);
  });
});

describe("checkPublicUrl (DNS)", () => {
  it("accepts a host that resolves to public addresses", async () => {
    expect((await checkPublicUrl("https://example.com/x", resolveTo("93.184.216.34"))).ok).toBe(true);
  });
  it("refuses a public-looking name that resolves to a private address", async () => {
    expect((await checkPublicUrl("https://evil.example.com/", resolveTo("10.0.0.7"))).ok).toBe(false);
  });
  it("refuses when ANY resolved address is private (DNS rebinding with mixed answers)", async () => {
    expect((await checkPublicUrl("https://evil.example.com/", resolveTo("93.184.216.34", "127.0.0.1"))).ok).toBe(false);
  });
  it("refuses when the name does not resolve", async () => {
    const failing: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    expect((await checkPublicUrl("https://nope.example.com/", failing)).ok).toBe(false);
  });
});

describe("safeFetchText", () => {
  const page = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });

  it("fetches a public page and sends the given user agent", async () => {
    let seenUa = "";
    const fetchImpl = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      seenUa = new Headers(init?.headers).get("user-agent") ?? "";
      return page("<h1>Pricing</h1>");
    }) as typeof fetch;
    const res = await safeFetchText("https://tool.example.com/pricing", { fetchImpl, resolver: resolveTo("93.184.216.34"), userAgent: "TestRadar/1.0" });
    expect(res.text).toContain("Pricing");
    expect(seenUa).toBe("TestRadar/1.0");
  });

  it("re-checks every redirect and refuses one that points at a private address", async () => {
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data/" } })) as typeof fetch;
    await expect(safeFetchText("https://tool.example.com/", { fetchImpl, resolver: resolveTo("93.184.216.34") })).rejects.toMatchObject({ code: "unsafe_url" });
  });

  it("refuses a redirect to http", async () => {
    const fetchImpl = (async () => new Response(null, { status: 301, headers: { location: "http://tool.example.com/" } })) as typeof fetch;
    await expect(safeFetchText("https://tool.example.com/", { fetchImpl, resolver: resolveTo("93.184.216.34") })).rejects.toMatchObject({ code: "unsafe_url" });
  });

  it("stops after too many redirects", async () => {
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: "https://tool.example.com/again" } })) as typeof fetch;
    await expect(safeFetchText("https://tool.example.com/", { fetchImpl, resolver: resolveTo("93.184.216.34"), maxRedirects: 2 })).rejects.toMatchObject({ code: "unsafe_url" });
  });

  it("truncates an oversized body", async () => {
    const fetchImpl = (async () => page("x".repeat(5000))) as typeof fetch;
    const res = await safeFetchText("https://tool.example.com/", { fetchImpl, resolver: resolveTo("93.184.216.34"), maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBe(1000);
  });
});
