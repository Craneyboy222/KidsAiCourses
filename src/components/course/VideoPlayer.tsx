"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Callout, Switch } from "@/components/ui";
import { VIDEO_SPEEDS } from "@/lib/learning/step-data";

export type VideoPlayerProps = {
  /** What the video is, for its accessible name. */
  title: string;
  /** Signed link to the file, or null when there is nothing to play yet. */
  src: string | null;
  /** Signed link to the captions. A video is never shown without them: with no captions it counts as not ready. */
  captionsSrc: string | null;
  posterSrc: string | null;
  /** The transcript, already rendered. Shown under the video and as the whole experience in low-data mode. */
  transcript: ReactNode | null;
  initialPosition?: number;
  initialSpeed?: number;
  /** Called (at most every few seconds) with the largest share watched and the current position. */
  onProgress?: (watchedFraction: number, position: number) => void;
  onSpeedChange?: (speed: number) => void;
  /** Called the first time the transcript is opened. Reading it counts the same as watching. */
  onTranscriptRead?: () => void;
};

const LOW_DATA_KEY = "player.lowData";
const REPORT_EVERY_MS = 5000;

/**
 * A plain native video: captions on by default, a transcript, speed control, no autoplay, and
 * every control reachable from the keyboard because the browser's own controls are used
 * (spec 3.2). Low-data mode loads nothing until the learner asks for it.
 */
export function VideoPlayer({ title, src, captionsSrc, posterSrc, transcript, initialPosition = 0, initialSpeed = 1, onProgress, onSpeedChange, onTranscriptRead }: VideoPlayerProps) {
  const video = useRef<HTMLVideoElement | null>(null);
  const speedId = useId();
  const [speed, setSpeed] = useState(initialSpeed);
  const [lowData, setLowData] = useState(false);
  const [loadAnyway, setLoadAnyway] = useState(false);
  const [failed, setFailed] = useState(false);
  const best = useRef(0);
  const lastReport = useRef(0);
  const transcriptSeen = useRef(false);
  const progress = useRef(onProgress);
  useEffect(() => {
    progress.current = onProgress;
  });

  // The choice is kept on this device only: it is about this connection, not about the learner.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LOW_DATA_KEY) === "1") setLowData(true);
    } catch {
      // Storage is unavailable: the default (off) stands.
    }
  }, []);

  function chooseLowData(on: boolean) {
    setLowData(on);
    setLoadAnyway(false);
    try {
      window.localStorage.setItem(LOW_DATA_KEY, on ? "1" : "0");
    } catch {
      // Not remembered, but it still applies to this page.
    }
  }

  function report(force: boolean) {
    const element = video.current;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
    best.current = Math.max(best.current, Math.min(1, element.currentTime / element.duration));
    const now = Date.now();
    if (!force && now - lastReport.current < REPORT_EVERY_MS) return;
    lastReport.current = now;
    progress.current?.(best.current, element.currentTime);
  }

  function openTranscript(open: boolean) {
    if (!open || transcriptSeen.current) return;
    transcriptSeen.current = true;
    onTranscriptRead?.();
  }

  // Captions are not optional (spec 3.2, WCAG 1.2.2): without them the video is treated as not ready.
  const source = src !== null && captionsSrc !== null ? { src, captionsSrc } : null;
  const showVideo = source !== null && !failed && (!lowData || loadAnyway);
  const crossOrigin = source !== null && /^https?:/i.test(source.src) ? ("anonymous" as const) : undefined;

  return (
    <div className="flex flex-col gap-3">
      {source === null || failed ? (
        <Callout tone="info" title={failed ? "The video didn't load" : "This video isn't ready to play yet"}>
          <p>{transcript ? "The transcript below covers the same ground, so you can carry on." : "You can carry on to the next step: this one won't hold you up."}</p>
          {failed && <p className="text-ink-muted text-sm">If you&apos;ve had this page open for a while, reloading it usually fixes it.</p>}
        </Callout>
      ) : showVideo ? (
        <video
          ref={video}
          className="rounded-card border-ink bg-ink aspect-video w-full border-2"
          controls
          playsInline
          preload={lowData ? "none" : "metadata"}
          poster={posterSrc ?? undefined}
          crossOrigin={crossOrigin}
          aria-label={title}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            element.playbackRate = speed;
            if (initialPosition > 0 && initialPosition < element.duration - 2) element.currentTime = initialPosition;
          }}
          onTimeUpdate={() => report(false)}
          onPause={() => report(true)}
          onEnded={() => report(true)}
          onError={() => setFailed(true)}
        >
          <source src={source.src} />
          <track kind="captions" src={source.captionsSrc} srcLang="en" label="English" default />
        </video>
      ) : (
        <div className="rounded-card border-ink bg-tint flex aspect-video w-full flex-col items-center justify-center gap-3 border-2 p-4 text-center">
          <p className="font-bold">Low-data mode is on, so the video hasn&apos;t loaded.</p>
          <Button variant="secondary" onClick={() => setLoadAnyway(true)}>
            Load the video anyway
          </Button>
        </div>
      )}

      {source !== null && !failed && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <label htmlFor={speedId} className="text-sm font-bold">
              Speed
            </label>
            <select
              id={speedId}
              className="rounded-control border-ink bg-surface text-ink min-h-11 border-2 px-2"
              value={String(speed)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSpeed(next);
                if (video.current) video.current.playbackRate = next;
                onSpeedChange?.(next);
              }}
            >
              {VIDEO_SPEEDS.map((value) => (
                <option key={value} value={String(value)}>
                  {value === 1 ? "Normal" : `${value}×`}
                </option>
              ))}
            </select>
          </div>
          <Switch label="Low-data mode" description="Read the transcript instead of loading the video." checked={lowData} onChange={(event) => chooseLowData(event.target.checked)} />
        </div>
      )}

      {transcript && (
        <details className="group rounded-card border-ink bg-surface border-2" open={source === null || failed || (lowData && !loadAnyway) || undefined} onToggle={(event) => openTranscript(event.currentTarget.open)}>
          <summary className="hover:bg-tint flex min-h-11 items-center px-4 py-2 font-bold -outline-offset-4">Read the transcript</summary>
          <div className="border-line border-t-2 p-4">{transcript}</div>
        </details>
      )}
    </div>
  );
}
