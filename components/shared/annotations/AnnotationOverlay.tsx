"use client";
/**
 * Draws a clip's annotations over its <video>, each one during its window, with
 * a short fade. Used by the studio (stitched timeline; pass `nowMs`) and the
 * customer page (clip time; the overlay follows the video itself).
 * Never takes pointer events, so the video and its controls work underneath.
 */
import { useEffect, useState } from "react";
import { opacityAt, type Stroke } from "@/lib/annotations";
import { StrokesSvg } from "./StrokesSvg";
import { useFrameRect } from "./useFrameRect";

interface Timed {
  start_ms: number;
  end_ms: number;
  strokes: Stroke[];
}

export function AnnotationOverlay({
  videoRef,
  annotations,
  nowMs,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  annotations: readonly Timed[];
  /** The playhead, when the caller already tracks it. Otherwise read from the video. */
  nowMs?: number;
}) {
  const rect = useFrameRect(videoRef);
  const tracked = useVideoTime(videoRef, nowMs === undefined && annotations.length > 0);
  const now = nowMs ?? tracked;

  if (!rect || annotations.length === 0) return null;
  const shown = annotations
    .map((a, i) => ({ a, i, opacity: opacityAt(a, now) }))
    .filter((x) => x.opacity > 0);
  if (shown.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {shown.map(({ a, i, opacity }) => (
        <StrokesSvg key={i} strokes={a.strokes} width={rect.width} height={rect.height} style={{ opacity }} />
      ))}
    </div>
  );
}

/** The video's currentTime in ms: every frame while playing, on seek/timeupdate otherwise. */
function useVideoTime(videoRef: React.RefObject<HTMLVideoElement | null>, enabled: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !enabled) return;
    let raf = 0;
    const read = () => setMs(v.currentTime * 1000);
    const tick = () => {
      read();
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onStop = () => {
      cancelAnimationFrame(raf);
      read();
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onStop);
    v.addEventListener("ended", onStop);
    v.addEventListener("seeked", read);
    v.addEventListener("timeupdate", read);
    if (!v.paused) onPlay();
    else read();
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onStop);
      v.removeEventListener("ended", onStop);
      v.removeEventListener("seeked", read);
      v.removeEventListener("timeupdate", read);
    };
  }, [videoRef, enabled]);
  return ms;
}
