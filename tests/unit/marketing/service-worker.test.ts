import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLEAR_CACHES_MESSAGE, SERVICE_WORKER_URL } from "@/lib/marketing/service-worker-client";
import { PRIVATE_SEGMENTS } from "@/lib/marketing/site";

/**
 * `public/sw.js` is plain JavaScript served as it is, so it is loaded here exactly as a browser
 * would run it, with a pretend `self`, `caches` and `fetch`. The rules under test: only the
 * static shell and /offline are ever stored; no page or API response from a signed-in area is
 * stored or answered from storage; everything is thrown away on sign-out.
 */
const SOURCE = readFileSync(join(__dirname, "..", "..", "..", "public", "sw.js"), "utf8");
const ORIGIN = "https://studio.example";

type Req = { method: string; url: string; mode: string; destination: string; headers?: Headers };
type Sw = {
  CACHE_NAME: string;
  CACHE_PREFIX: string;
  CLEAR_CACHES_MESSAGE: string;
  OFFLINE_URL: string;
  PRIVATE_SEGMENTS: string[];
  isCacheable(pathname: string): boolean;
  isProtectedPath(pathname: string): boolean;
  isStorableResponse(response: unknown): boolean;
  staticAssetsIn(html: string): string[];
  routeRequest(request: Req, origin: string): "bypass" | "static" | "navigate";
  onFetch(event: unknown): void;
  onInstall(event: unknown): void;
  onMessage(event: unknown): void;
};

const response = (body: string, init: { status?: number; type?: string; headers?: Record<string, string> } = {}) => ({
  status: init.status ?? 200,
  type: init.type ?? "basic",
  headers: new Headers(init.headers ?? {}),
  body,
  clone() {
    return response(body, init);
  },
  text: async () => body,
});
type FakeResponse = ReturnType<typeof response>;

/** A worker with a pretend browser around it. `puts` records every address that was stored. */
function loadWorker(fetchImpl: (url: string, request: { credentials?: string }) => Promise<FakeResponse>) {
  const stores = new Map<string, Map<string, FakeResponse>>();
  const puts: string[] = [];
  const keyOf = (request: string | { url: string }) => {
    const raw = typeof request === "string" ? request : request.url;
    const url = new URL(raw, ORIGIN);
    return url.pathname + url.search;
  };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (request: string | { url: string }, res: FakeResponse) => {
          puts.push(keyOf(request));
          store.set(keyOf(request), res);
        },
      };
    },
    match: async (request: string | { url: string }) => {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(request));
        if (hit) return hit;
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  class FakeRequest {
    url: string;
    credentials?: string;
    constructor(url: string, init: { credentials?: string } = {}) {
      this.url = new URL(url, ORIGIN).toString();
      this.credentials = init.credentials;
    }
  }
  const fetchCalls: { path: string; credentials?: string }[] = [];
  const fetch = vi.fn(async (request: FakeRequest | Req) => {
    const path = keyOf(request);
    const credentials = "credentials" in request ? request.credentials : undefined;
    fetchCalls.push({ path, credentials });
    return fetchImpl(path, { credentials });
  });
  const listeners = new Map<string, unknown>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: unknown) => listeners.set(type, handler),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const holder: { exports: Partial<Sw> } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the worker is a classic script, loaded as the browser loads it
  new Function("module", "self", "caches", "fetch", "Request", "Response", "URL", SOURCE)(holder, self, caches, fetch, FakeRequest, globalThis.Response, URL);
  return { sw: holder.exports as Sw, stores, puts, fetchCalls, listeners };
}

/** Runs one fetch event to the end, including work handed to `waitUntil`. */
async function dispatch(sw: Sw, request: Req) {
  const waits: Promise<unknown>[] = [];
  let answered: Promise<unknown> | null = null;
  sw.onFetch({
    request,
    respondWith: (promise: Promise<unknown>) => {
      answered = promise;
    },
    waitUntil: (promise: Promise<unknown>) => {
      waits.push(promise);
    },
  });
  const result = answered ? await (answered as Promise<unknown>) : null;
  await Promise.all(waits);
  return { handled: answered !== null, result: result as FakeResponse | null };
}

const page = (path: string): Req => ({ method: "GET", url: `${ORIGIN}${path}`, mode: "navigate", destination: "document" });
const data = (path: string, method = "GET"): Req => ({ method, url: `${ORIGIN}${path}`, mode: "cors", destination: "" });
const asset = (path: string): Req => ({ method: "GET", url: `${ORIGIN}${path}`, mode: "no-cors", destination: "script" });

/** Every kind of private address: signed-in pages, their data, the API, sign-in, and links that carry a code. */
const PROTECTED_PATHS = [
  "/home",
  "/explore",
  "/explore/build-an-app",
  "/learn/build-an-app/s1",
  "/portfolio",
  "/portfolio/123",
  "/certificates",
  "/settings",
  "/settings/billing",
  "/onboarding",
  "/parent",
  "/parent/billing",
  "/parent/children/abc/controls",
  "/studio",
  "/studio/safeguarding/1",
  "/signin",
  "/signup/parent",
  "/reset",
  "/verify/ABCD-EFGH",
  "/approve/some-token",
  "/join/CODE123",
  "/preview/draft-token",
  "/api/health",
  "/api/v1/ai/chat",
  "/api/v1/projects/1",
  "/api/auth/get-session",
  "/api/files/private/key.png",
  "/dev/kit",
  "/HOME",
  "/Parent/Billing",
];

describe("the routing function", () => {
  const { sw } = loadWorker(async () => response("ok"));

  it("keeps the same list of private areas as the rest of the site", () => {
    // `/offline` is private to crawlers but is the one page the worker is there to keep.
    expect([...sw.PRIVATE_SEGMENTS].sort()).toEqual(PRIVATE_SEGMENTS.filter((segment) => segment !== "offline").sort());
    expect(sw.CLEAR_CACHES_MESSAGE).toBe(CLEAR_CACHES_MESSAGE);
    expect(SERVICE_WORKER_URL).toBe("/sw.js");
  });

  it.each(PROTECTED_PATHS)("never allows %s to be stored", (path) => {
    expect(sw.isProtectedPath(path)).toBe(true);
    expect(sw.isCacheable(path)).toBe(false);
    // Whatever kind of request it is, the answer is never "static", the only route that stores.
    for (const request of [page(path), data(path), asset(path), data(`${path}?_rsc=abc`), data(path, "POST")]) {
      expect(sw.routeRequest(request, ORIGIN), `${request.method} ${request.url} (${request.mode})`).not.toBe("static");
    }
  });

  it("stores only build files, icons and the offline page", () => {
    for (const path of ["/_next/static/chunks/app.js", "/_next/static/media/font.woff2", "/icons/icon-192.png", "/offline"]) expect(sw.isCacheable(path), path).toBe(true);
    for (const path of ["/", "/courses", "/courses/build-an-app", "/pricing", "/help", "/legal/privacy", "/sw.js", "/manifest.webmanifest", "/_next/image", "/_next/data/x.json", "/favicon.ico", "/_next/static/../../home"]) {
      expect(sw.isCacheable(path), path).toBe(false);
    }
  });

  it("sends pages to the network with an offline fallback, build files to storage, and leaves everything else alone", () => {
    expect(sw.routeRequest(page("/"), ORIGIN)).toBe("navigate");
    expect(sw.routeRequest(page("/home"), ORIGIN)).toBe("navigate");
    expect(sw.routeRequest(asset("/_next/static/chunks/app.js"), ORIGIN)).toBe("static");
    expect(sw.routeRequest(asset("/icons/icon.svg"), ORIGIN)).toBe("static");
    // Page data fetched by the app's router, form posts, other sites, and API addresses opened in a tab.
    expect(sw.routeRequest(data("/courses?_rsc=1"), ORIGIN)).toBe("bypass");
    expect(sw.routeRequest(data("/home", "POST"), ORIGIN)).toBe("bypass");
    expect(sw.routeRequest({ ...asset("/_next/static/chunks/app.js"), url: "https://elsewhere.example/_next/static/chunks/app.js" }, ORIGIN)).toBe("bypass");
    expect(sw.routeRequest(page("/api/v1/data-requests/1/download"), ORIGIN)).toBe("bypass");
    expect(sw.routeRequest({ ...page("/"), url: "not a url" }, ORIGIN)).toBe("bypass");
  });

  it("refuses to store a response that is private, partial, redirected or from another site", () => {
    expect(sw.isStorableResponse(response("x", { headers: { "cache-control": "public, max-age=31536000, immutable" } }))).toBe(true);
    expect(sw.isStorableResponse(response("x", { headers: { "cache-control": "private, no-cache" } }))).toBe(false);
    expect(sw.isStorableResponse(response("x", { headers: { "cache-control": "no-store" } }))).toBe(false);
    expect(sw.isStorableResponse(response("x", { status: 206 }))).toBe(false);
    expect(sw.isStorableResponse(response("x", { status: 404 }))).toBe(false);
    expect(sw.isStorableResponse(response("x", { type: "opaque" }))).toBe(false);
    expect(sw.isStorableResponse(response("x", { type: "opaqueredirect" }))).toBe(false);
    expect(sw.isStorableResponse(null)).toBe(false);
  });

  it("finds the build files a page needs, and nothing else", () => {
    const html = `<link rel="stylesheet" href="/_next/static/chunks/a1.css"><script src="/_next/static/chunks/b-2.js"></script><script>self.x="\\"/_next/static/chunks/b-2.js\\""</script><a href="/home">x</a><img src="/api/files/a.png">`;
    expect(sw.staticAssetsIn(html)).toEqual(["/_next/static/chunks/a1.css", "/_next/static/chunks/b-2.js"]);
  });
});

describe("the worker at run time", () => {
  const OFFLINE_HTML = `<html><link rel="stylesheet" href="/_next/static/chunks/site.css"><h1>You're offline</h1></html>`;
  const online = async (path: string) => {
    if (path === "/offline") return response(OFFLINE_HTML, { headers: { "cache-control": "private, no-cache, no-store" } });
    if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) return response(`file ${path}`, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
    return response(`<html>private page ${path}</html>`, { headers: { "cache-control": "private, no-store" } });
  };

  async function installed(fetchImpl = online) {
    const worker = loadWorker(fetchImpl);
    const waits: Promise<unknown>[] = [];
    worker.sw.onInstall({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
    return worker;
  }

  it("registers its handlers", () => {
    const { listeners } = loadWorker(online);
    expect([...listeners.keys()].sort()).toEqual(["activate", "fetch", "install", "message"]);
  });

  it("on install, stores the offline page (fetched signed out), its build files and the icons, and nothing else", async () => {
    const { puts, fetchCalls } = await installed();
    expect([...puts].sort()).toEqual(["/_next/static/chunks/site.css", "/icons/icon-192.png", "/icons/icon.svg", "/offline"]);
    // No cookie is ever sent when the worker fetches something to keep.
    expect(fetchCalls.every((call) => call.credentials === "omit")).toBe(true);
  });

  it("never stores a page, page data or an API response from a signed-in area, whatever is requested", async () => {
    const { sw, puts } = await installed();
    const before = puts.length;
    for (const path of PROTECTED_PATHS) {
      const navigation = await dispatch(sw, page(path));
      // Pages are answered from the network (or not handled at all, for the API): never from storage.
      if (navigation.handled) expect(navigation.result?.body, path).toContain("private page");
      expect((await dispatch(sw, data(`${path}?_rsc=1`))).handled, path).toBe(false);
      expect((await dispatch(sw, data(path, "POST"))).handled, path).toBe(false);
      await dispatch(sw, asset(path));
    }
    for (const path of ["/", "/courses", "/pricing", "/help/invite-codes", "/legal/privacy"]) await dispatch(sw, page(path));
    expect(puts.slice(before).filter((path) => !path.startsWith("/_next/static/") && !path.startsWith("/icons/") && path !== "/offline")).toEqual([]);
    expect(puts.some((path) => PROTECTED_PATHS.includes(path))).toBe(false);
  });

  it("stores a build file the first time and answers from storage after that", async () => {
    const { sw, puts, fetchCalls } = await installed();
    const first = await dispatch(sw, asset("/_next/static/chunks/page.js"));
    expect(first.result?.body).toBe("file /_next/static/chunks/page.js");
    expect(puts).toContain("/_next/static/chunks/page.js");
    const fetchesBefore = fetchCalls.length;
    const second = await dispatch(sw, asset("/_next/static/chunks/page.js"));
    expect(second.result?.body).toBe("file /_next/static/chunks/page.js");
    expect(fetchCalls.length).toBe(fetchesBefore);
  });

  it("shows the offline page when a page cannot be loaded, including a signed-in one, without storing anything", async () => {
    let offline = false;
    const worker = await installed(async (path) => {
      if (offline) throw new TypeError("Failed to fetch");
      return online(path);
    });
    offline = true;
    const before = worker.puts.length;
    for (const path of ["/", "/home", "/parent/billing", "/learn/build-an-app/s1"]) {
      const { result } = await dispatch(worker.sw, page(path));
      expect(result?.body, path).toContain("You're offline");
      expect(result?.body, path).not.toContain("private page");
    }
    expect(worker.puts.length).toBe(before);
  });

  it("answers with a plain message if the offline page itself was never stored", async () => {
    const { sw } = loadWorker(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = await dispatch(sw, page("/home"));
    expect((result as unknown as Response).status).toBe(503);
  });

  it("throws everything away on sign-out, then keeps only the signed-out shell again", async () => {
    const signals: [string, (sw: Sw) => Promise<unknown>][] = [
      ["a message from the sign-out button", async (sw) => {
        const waits: Promise<unknown>[] = [];
        sw.onMessage({ data: { type: CLEAR_CACHES_MESSAGE }, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
        await Promise.all(waits);
      }],
      ["a sign-out request going past", (sw) => dispatch(sw, data("/api/auth/sign-out", "POST"))],
      ["the sign-in page being opened", (sw) => dispatch(sw, page("/signin"))],
    ];
    for (const [name, signal] of signals) {
      const { sw, stores, puts } = await installed();
      await dispatch(sw, asset("/_next/static/chunks/learner-area.js"));
      expect(stores.get(sw.CACHE_NAME)?.has("/_next/static/chunks/learner-area.js"), name).toBe(true);
      puts.length = 0;
      await signal(sw);
      const kept = [...(stores.get(sw.CACHE_NAME)?.keys() ?? [])].sort();
      expect(kept, name).toEqual(["/_next/static/chunks/site.css", "/icons/icon-192.png", "/icons/icon.svg", "/offline"]);
    }
  });

  it("does not clear anything for an unrelated message, or when the app only fetches the sign-in page's data in the background", async () => {
    const { sw, stores } = await installed();
    await dispatch(sw, asset("/_next/static/chunks/kept.js"));
    const waits: Promise<unknown>[] = [];
    sw.onMessage({ data: { type: "SOMETHING_ELSE" }, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
    await dispatch(sw, data("/signin?_rsc=prefetch"));
    expect(stores.get(sw.CACHE_NAME)?.has("/_next/static/chunks/kept.js")).toBe(true);
  });
});
