"use client";

import { useEffect } from "react";
import { removeServiceWorker, registerServiceWorker } from "@/lib/marketing/service-worker-client";

/**
 * Registers `public/sw.js`, which makes the site installable and shows the offline page when the
 * connection drops. Renders nothing.
 *
 * `enabled` is false in development: the worker keeps build files, and a development server
 * changes those on every edit. When it is false, a worker left over from an earlier production
 * run on the same address is removed, with its stored files.
 */
export function ServiceWorkerRegistration({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (enabled) void registerServiceWorker();
    else void removeServiceWorker();
  }, [enabled]);
  return null;
}
