"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** How often active time is reported. The server bounds every report by its own clock as well. */
export const HEARTBEAT_MS = 30_000;

export type HeartbeatAnswer =
  | { allowed: true; minutesLeftToday: number | null }
  | { allowed: false; reason: "paused" | "time_cap" | "quiet_hours" | "consent" | "not_active"; message: string };

/**
 * Reports active time (spec 3.2, 3.6): only the seconds this tab was VISIBLE since the last
 * report, every 30 seconds, and nothing at all while the tab is hidden. The answer says whether
 * learning may carry on; the caller decides what to do when it may not. A failed report is simply
 * not counted: being offline never blocks anyone.
 */
export function useHeartbeat(enabled: boolean, onAnswer: (answer: HeartbeatAnswer) => void): void {
  const handler = useRef(onAnswer);
  useEffect(() => {
    handler.current = onAnswer;
  });
  useEffect(() => {
    if (!enabled) return;
    let visibleSince = document.visibilityState === "visible" ? Date.now() : null;
    let banked = 0;
    const bank = () => {
      if (visibleSince !== null) {
        banked += (Date.now() - visibleSince) / 1000;
        visibleSince = Date.now();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") visibleSince = Date.now();
      else {
        bank();
        visibleSince = null;
      }
    };
    const beat = async () => {
      bank();
      const seconds = Math.round(banked);
      if (seconds < 1) return;
      banked = 0;
      try {
        const response = await fetch("/api/v1/usage/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seconds }), credentials: "same-origin" });
        if (response.ok) handler.current((await response.json()) as HeartbeatAnswer);
      } catch {
        // Offline: the time is not counted, and nothing is blocked.
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [enabled]);
}

/**
 * The heartbeat for the learner pages outside the player (home, explore, settings). Time on the
 * platform counts towards a parent's daily cap wherever it is spent. When the cap or quiet hours
 * arrive, the page is refreshed so the notice in the frame appears. Renders nothing.
 */
export function UsageHeartbeat() {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  useHeartbeat(!stopped, (answer) => {
    if (answer.allowed) return;
    setStopped(true);
    router.refresh();
  });
  return null;
}
