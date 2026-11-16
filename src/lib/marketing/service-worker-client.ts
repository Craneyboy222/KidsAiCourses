/**
 * Browser-side helpers for the service worker in `public/sw.js`. Safe to import anywhere on the
 * client; every function is a no-op where service workers are not supported.
 */
export const SERVICE_WORKER_URL = "/sw.js";
/** The message that tells the worker to throw away everything it has stored. */
export const CLEAR_CACHES_MESSAGE = "CLEAR_CACHES";

const supported = (): boolean => typeof navigator !== "undefined" && "serviceWorker" in navigator;

export async function registerServiceWorker(): Promise<void> {
  if (!supported()) return;
  try {
    // `updateViaCache: "none"`: the browser always asks the server for a fresh copy of the worker.
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" });
  } catch {
    // The site works without it; there is nothing useful to tell the visitor.
  }
}

/** Unregisters the worker and deletes its stored files. */
export async function removeServiceWorker(): Promise<void> {
  if (!supported()) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("platform-")).map((name) => caches.delete(name)));
    }
  } catch {
    // Nothing to clean up, or storage is unavailable (private browsing).
  }
}

/**
 * Tells the worker to throw away everything it has stored. The sign-out button calls this as its
 * form is submitted. The worker also clears itself when a sign-out request goes past and when the
 * sign-in page is opened, which covers signing out with JavaScript switched off.
 */
export function clearServiceWorkerCaches(): void {
  if (!supported()) return;
  navigator.serviceWorker.controller?.postMessage({ type: CLEAR_CACHES_MESSAGE });
}
