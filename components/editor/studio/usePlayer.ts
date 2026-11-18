"use client";
/** One shared <video> for the studio: playhead state, seeking, play/pause and range preview. */
import { useCallback, useEffect, useRef, useState } from "react";
import { clampMs } from "@/lib/editor/clipRange";

export interface Player {
  ref: React.RefObject<HTMLVideoElement | null>;
  /** Playhead in ms (smooth while playing). */
  now: number;
  playing: boolean;
  muted: boolean;
  /** Duration from the video's metadata, if the inspection doesn't have one. */
  metaDurationMs: number | null;
  seek: (ms: number) => void;
  toggle: () => void;
  toggleMute: () => void;
  /** Play from start to end, then stop. */
  playRange: (startMs: number, endMs: number) => void;
  /** Exact playhead read from the element. */
  current: () => number;
  /** Spread onto the <video>. */
  videoProps: React.VideoHTMLAttributes<HTMLVideoElement>;
}

export function usePlayer(durationMs: number | null): Player {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [metaDurationMs, setMetaDurationMs] = useState<number | null>(null);
  const stopAt = useRef<number | null>(null);
  const dur = durationMs ?? metaDurationMs;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v) {
        const ms = v.currentTime * 1000;
        setNow(ms);
        if (stopAt.current !== null && ms >= stopAt.current) {
          v.pause();
          stopAt.current = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback(
    (ms: number) => {
      const t = clampMs(ms, dur);
      const v = ref.current;
      if (v) v.currentTime = t / 1000;
      setNow(t);
    },
    [dur],
  );

  const current = useCallback(() => {
    const v = ref.current;
    return v ? clampMs(v.currentTime * 1000, dur) : 0;
  }, [dur]);

  const toggle = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      stopAt.current = null;
      void v.play().catch(() => {});
    } else v.pause();
  }, []);

  const playRange = useCallback(
    (startMs: number, endMs: number) => {
      const v = ref.current;
      if (!v) return;
      seek(startMs);
      stopAt.current = endMs;
      void v.play().catch(() => {
        stopAt.current = null;
      });
    },
    [seek],
  );

  const toggleMute = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const sync = () => setNow((ref.current?.currentTime ?? 0) * 1000);

  return {
    ref,
    now,
    playing,
    muted,
    metaDurationMs,
    seek,
    toggle,
    toggleMute,
    playRange,
    current,
    videoProps: {
      onPlay: () => setPlaying(true),
      onPause: () => {
        setPlaying(false);
        stopAt.current = null;
        sync();
      },
      onSeeked: sync,
      onTimeUpdate: () => !playing && sync(),
      onLoadedMetadata: () => {
        const v = ref.current;
        if (v && Number.isFinite(v.duration)) setMetaDurationMs(Math.round(v.duration * 1000));
      },
    },
  };
}
