/*
 * The service worker. It does two small things and nothing else:
 *
 *   1. keeps the static shell (the site's own build files and icons) and one page, /offline;
 *   2. shows /offline when a page cannot be loaded because there is no connection.
 *
 * Safety rules, each covered by tests/unit/marketing/service-worker.test.ts:
 *
 *   - Only addresses on the allow-list in `isCacheable` are ever stored. Every page, every API
 *     response and anything from a signed-in area goes straight to the network and is never kept.
 *   - /offline is fetched signed out (no cookies), so the stored copy is the same for everyone.
 *   - Everything stored is thrown away on sign-out: when the sign-out button says so (a
 *     CLEAR_CACHES message), when a sign-out request goes past, and when the sign-in page is
 *     opened (which is where signing out without JavaScript lands).
 *
 * Plain JavaScript on purpose: this file is served as it is, with no build step. The private
 * prefixes below mirror PRIVATE_SEGMENTS in src/lib/marketing/site.ts; the test fails if they differ.
 */
"use strict";

var CACHE_PREFIX = "platform-";
var CACHE_NAME = CACHE_PREFIX + "shell-v1";
var OFFLINE_URL = "/offline";
var CLEAR_CACHES_MESSAGE = "CLEAR_CACHES";

/** Stored when the worker is installed, so the offline page has its icon. Build files are added as the offline page asks for them. */
var PRECACHE_URLS = ["/icons/icon.svg", "/icons/icon-192.png"];

/** Build files (content-hashed, the same for everyone) and icons. */
var STATIC_PREFIXES = ["/_next/static/", "/icons/"];

/** First path segments that are private. Nothing under them is ever stored, and they are never served from storage. */
var PRIVATE_SEGMENTS = [
  "home",
  "explore",
  "learn",
  "portfolio",
  "certificates",
  "settings",
  "onboarding",
  "parent",
  "studio",
  "signin",
  "signup",
  "reset",
  "blocked-age",
  "verify",
  "approve",
  "join",
  "preview",
  "api",
  "dev",
];

function firstSegment(pathname) {
  return (pathname.split("/")[1] || "").toLowerCase();
}

/** True for a signed-in area, the API, sign-in and sign-up, and links that carry a code or token. */
function isProtectedPath(pathname) {
  return PRIVATE_SEGMENTS.indexOf(firstSegment(pathname)) !== -1;
}

function isStaticPath(pathname) {
  for (var i = 0; i < STATIC_PREFIXES.length; i += 1) {
    if (pathname.indexOf(STATIC_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/**
 * The allow-list: the only addresses this worker may store. A protected path is refused first,
 * so no later change to the list below can let one in.
 */
function isCacheable(pathname) {
  if (isProtectedPath(pathname)) return false;
  if (pathname.indexOf("..") !== -1) return false;
  return pathname === OFFLINE_URL || isStaticPath(pathname);
}

/** The page every sign-out ends on. Opening it as a page (not a background fetch) clears what is stored. */
function isSignOutLanding(pathname) {
  return pathname === "/signin";
}

/** The sign-out call itself, whichever way it is made. */
function isSignOutRequest(pathname) {
  return pathname === "/api/auth/sign-out";
}

/** The build files a stored page needs: every /_next/static address its HTML mentions. */
function staticAssetsIn(html) {
  var found = html.match(/\/_next\/static\/[A-Za-z0-9_\-.\/%~@\[\]()]+\.(?:css|js|woff2)/g) || [];
  var unique = [];
  for (var i = 0; i < found.length; i += 1) {
    if (unique.indexOf(found[i]) === -1 && isCacheable(found[i])) unique.push(found[i]);
  }
  return unique.slice(0, 80);
}

/**
 * What to do with one request. `request` needs `method`, `url`, `mode` and `destination`.
 *
 *   "bypass"   leave it to the browser: no storing, no stored answer, no fallback
 *   "static"   a build file or icon: answer from storage, or fetch and store it
 *   "navigate" a page: always the network; if there is no connection, show the offline page
 *
 * Only "static" stores anything, and only for an address `isCacheable` accepts.
 */
function routeRequest(request, origin) {
  if (request.method !== "GET") return "bypass";
  var url;
  try {
    url = new URL(request.url);
  } catch {
    return "bypass";
  }
  if (url.origin !== origin) return "bypass";
  if (request.mode === "navigate" || request.destination === "document") {
    // The API never gets a page as an answer, even when someone opens an API address in a tab.
    return firstSegment(url.pathname) === "api" ? "bypass" : "navigate";
  }
  if (isStaticPath(url.pathname) && isCacheable(url.pathname)) return "static";
  return "bypass";
}

/** A response may be stored only if it is a plain, complete, same-origin success that nobody marked private. */
function isStorableResponse(response) {
  if (!response || response.status !== 200 || response.type !== "basic") return false;
  var cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
  if (cacheControl.indexOf("no-store") !== -1 || cacheControl.indexOf("private") !== -1) return false;
  return !response.headers.get("set-cookie");
}

function clearCaches() {
  return caches.keys().then(function (names) {
    return Promise.all(
      names
        .filter(function (name) {
          return name.indexOf(CACHE_PREFIX) === 0;
        })
        .map(function (name) {
          return caches.delete(name);
        }),
    );
  });
}

/** Fetches one allow-listed file with no cookies and stores it. A failure is not an error: the file is fetched again when needed. */
function storeFile(cache, path) {
  if (!isCacheable(path)) return Promise.resolve();
  return fetch(new Request(path, { credentials: "omit" }))
    .then(function (response) {
      if (isStorableResponse(response)) return cache.put(path, response);
      return undefined;
    })
    .catch(function () {
      return undefined;
    });
}

/** Stores the offline page (fetched with no cookies), the build files it needs and the icons. */
function precache() {
  return caches.open(CACHE_NAME).then(function (cache) {
    var offline = fetch(new Request(OFFLINE_URL, { credentials: "omit", cache: "reload" })).then(function (response) {
      // Stored whatever its Cache-Control says: it was fetched signed out, so it is the same page for everyone.
      if (response.status !== 200 || response.type !== "basic") return undefined;
      return response
        .clone()
        .text()
        .then(function (html) {
          return Promise.all(
            [cache.put(OFFLINE_URL, response)].concat(
              staticAssetsIn(html).map(function (path) {
                return storeFile(cache, path);
              }),
            ),
          );
        });
    });
    return Promise.all(
      [offline].concat(
        PRECACHE_URLS.map(function (path) {
          return storeFile(cache, path);
        }),
      ),
    );
  });
}

function offlineResponse() {
  return caches.match(OFFLINE_URL).then(function (stored) {
    if (stored) return stored;
    return new Response("You are offline. Check your connection, then try again.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  });
}

/** A page: the network, always. Nothing is stored. With no connection, the offline page. */
function handleNavigate(event) {
  var pathname = new URL(event.request.url).pathname;
  return fetch(event.request).then(
    function (response) {
      if (isSignOutLanding(pathname)) event.waitUntil(clearCaches().then(precache).catch(function () {}));
      return response;
    },
    function () {
      return offlineResponse();
    },
  );
}

/** A build file or icon: the stored copy if there is one, else fetch it and keep it. */
function handleStatic(event) {
  var request = event.request;
  var pathname = new URL(request.url).pathname;
  return caches.match(request).then(function (stored) {
    if (stored) return stored;
    return fetch(request).then(function (response) {
      if (isCacheable(pathname) && isStorableResponse(response)) {
        var copy = response.clone();
        event.waitUntil(
          caches.open(CACHE_NAME).then(function (cache) {
            return cache.put(request, copy);
          }),
        );
      }
      return response;
    });
  });
}

function onInstall(event) {
  event.waitUntil(
    precache().then(function () {
      return self.skipWaiting();
    }),
  );
}

function onActivate(event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME;
            })
            .map(function (name) {
              return caches.delete(name);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
}

function onFetch(event) {
  var request = event.request;
  var route = routeRequest(request, self.location.origin);
  if (route === "navigate") {
    event.respondWith(handleNavigate(event));
    return;
  }
  if (route === "static") {
    event.respondWith(handleStatic(event));
    return;
  }
  // Bypassed requests are not answered here. A sign-out request is still noticed on its way past.
  var url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin === self.location.origin && isSignOutRequest(url.pathname)) {
    event.waitUntil(clearCaches().then(precache).catch(function () {}));
  }
}

function onMessage(event) {
  if (event.data && event.data.type === CLEAR_CACHES_MESSAGE) {
    event.waitUntil(clearCaches().then(precache).catch(function () {}));
  }
}

if (typeof self !== "undefined" && typeof self.addEventListener === "function" && typeof caches !== "undefined") {
  self.addEventListener("install", onInstall);
  self.addEventListener("activate", onActivate);
  self.addEventListener("fetch", onFetch);
  self.addEventListener("message", onMessage);
}

// For the unit tests only: a service worker has no `module`, so this does nothing in a browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CACHE_NAME: CACHE_NAME,
    CACHE_PREFIX: CACHE_PREFIX,
    CLEAR_CACHES_MESSAGE: CLEAR_CACHES_MESSAGE,
    OFFLINE_URL: OFFLINE_URL,
    PRIVATE_SEGMENTS: PRIVATE_SEGMENTS,
    isCacheable: isCacheable,
    isProtectedPath: isProtectedPath,
    isSignOutLanding: isSignOutLanding,
    isSignOutRequest: isSignOutRequest,
    staticAssetsIn: staticAssetsIn,
    isStorableResponse: isStorableResponse,
    routeRequest: routeRequest,
    onFetch: onFetch,
    onInstall: onInstall,
    onActivate: onActivate,
    onMessage: onMessage,
  };
}
