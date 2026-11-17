"use client";
/**
 * Player for the stitched video plus a range picker:
 * - timeline with pause points, the selected range and the playhead (tap to seek)
 * - Set start / Set end at the playhead, ±0.5 s nudges
 * - Preview plays just the range
 * Manual ranges may cross pause points; the markers (and a note) make it visible.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { clampMs, formatMs, NUDGE_MS, pausePointsInside, rangeError } from "@/lib/editor/clipRange";

export interface Range {
  start: number | null;
  end: number | null;
}

const DEFAULT_LEN = 5000;

export function RangeEditor({
  videoUrl,
  durationMs,
  pausePointsMs,
  value,
  onChange,
  videoRef: externalRef,
  initialSeekMs,
  disabled,
}: {
  videoUrl: string;
  durationMs: number;
  pausePointsMs: number[];
  value: Range;
  onChange: (r: Range) => void;
  /** Lets the parent read the playhead (e.g. "Use current frame"). */
  videoRef?: RefObject<HTMLVideoElement | null>;
  initialSeekMs?: number;
  disabled?: boolean;
}) {
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const ref = externalRef ?? ownRef;
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const previewEnd = useRef<number | null>(null);

  // Smooth playhead while playing; stop at the end of a preview.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v) {
        const ms = v.currentTime * 1000;
        setNow(ms);
        if (previewEnd.current !== null && ms >= previewEnd.current) {
          v.pause();
          previewEnd.current = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ref]);

  const seek = (ms: number) => {
    const v = ref.current;
    if (!v) return;
    const t = clampMs(ms, durationMs);
    v.currentTime = t / 1000;
    setNow(t);
  };

  const playhead = () => clampMs((ref.current?.currentTime ?? now / 1000) * 1000, durationMs);

  const setStart = (ms: number) => {
    const start = clampMs(ms, durationMs);
    const end = value.end !== null && value.end > start ? value.end : clampMs(start + DEFAULT_LEN, durationMs);
    onChange({ start, end });
  };
  const setEnd = (ms: number) => {
    const end = clampMs(ms, durationMs);
    const start = value.start !== null && value.start < end ? value.start : clampMs(end - DEFAULT_LEN, durationMs);
    onChange({ start, end });
  };

  const preview = async () => {
    const v = ref.current;
    if (!v || value.start === null || value.end === null) return;
    previewEnd.current = value.end;
    seek(value.start);
    try {
      await v.play();
    } catch {
      previewEnd.current = null;
    }
  };

  const hasRange = value.start !== null && value.end !== null;
  const err = hasRange ? rangeError(value.start!, value.end!, durationMs) : null;
  const crossing = hasRange ? pausePointsInside(value.start!, value.end!, pausePointsMs) : [];
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={ref}
        src={videoUrl}
        controls
        playsInline
        preload="metadata"
        className="max-h-[45vh] w-full rounded-md"
        onLoadedMetadata={() => {
          if (initialSeekMs !== undefined) seek(initialSeekMs);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          previewEnd.current = null;
          setNow((ref.current?.currentTime ?? 0) * 1000);
        }}
        onSeeked={() => setNow((ref.current?.currentTime ?? 0) * 1000)}
        onTimeUpdate={() => !playing && setNow((ref.current?.currentTime ?? 0) * 1000)}
      />

      {/* Timeline: tap to seek. */}
      <div className="flex flex-col gap-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Video timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs / 1000)}
          aria-valuenow={Math.round(now / 1000)}
          aria-valuetext={formatMs(now)}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - rect.left) / rect.width) * durationMs);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") seek(playhead() - NUDGE_MS);
            if (e.key === "ArrowRight") seek(playhead() + NUDGE_MS);
          }}
          className="relative h-12 cursor-pointer touch-none overflow-hidden rounded-md border border-border bg-surface"
        >
          {hasRange ? (
            <div
              className={cn(
                "absolute inset-y-0 border-x-2",
                err ? "border-red-fg bg-red-bg" : "border-blue-fg bg-blue-bg",
              )}
              style={{ left: pct(value.start!), width: `calc(${pct(value.end!)} - ${pct(value.start!)})` }}
            />
          ) : null}
          {pausePointsMs.map((p) => (
            <div
              key={p}
              className="absolute inset-y-0 w-0 border-l-2 border-dashed border-amber-fg"
              style={{ left: pct(p) }}
              title={`Pause point at ${formatMs(p)}`}
            >
              <span className="absolute top-0.5 left-1 rounded-sm bg-amber-bg px-1 text-[10px] leading-4 font-medium text-amber-fg">
                Pause
              </span>
            </div>
          ))}
          <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: pct(now) }} />
        </div>
        <div className="flex justify-between text-xs text-muted tabular-nums">
          <span>0:00.0</span>
          <span>Playhead {formatMs(now)}</span>
          <span>{formatMs(durationMs)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Endpoint
          label="Start"
          value={value.start}
          disabled={disabled}
          onSet={() => setStart(playhead())}
          onNudge={(d) => value.start !== null && setStart(value.start + d)}
          onJump={() => value.start !== null && seek(value.start)}
        />
        <Endpoint
          label="End"
          value={value.end}
          disabled={disabled}
          onSet={() => setEnd(playhead())}
          onNudge={(d) => value.end !== null && setEnd(value.end + d)}
          onJump={() => value.end !== null && seek(value.end)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" onClick={preview} disabled={!hasRange || !!err}>
          ▶ Preview range
        </Button>
        {hasRange ? (
          <span className="text-sm text-muted tabular-nums">
            {formatMs(value.start!)} – {formatMs(value.end!)} ({((value.end! - value.start!) / 1000).toFixed(1)} s)
          </span>
        ) : (
          <span className="text-sm text-muted">Play or tap the timeline, then Set start and Set end.</span>
        )}
      </div>

      {err ? <p className="text-sm text-red-fg">{err}</p> : null}
      {!err && crossing.length ? (
        <p className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-sm text-amber-fg">
          This range crosses a pause point at {crossing.map(formatMs).join(", ")}, so the clip will jump between
          two recorded parts.
        </p>
      ) : null}
    </div>
  );
}

function Endpoint({
  label,
  value,
  onSet,
  onNudge,
  onJump,
  disabled,
}: {
  label: string;
  value: number | null;
  onSet: () => void;
  onNudge: (deltaMs: number) => void;
  onJump: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border p-2">
      <Button size="lg" variant="primary" className="flex-1" onClick={onSet} disabled={disabled}>
        Set {label.toLowerCase()}
      </Button>
      <Button
        size="lg"
        aria-label={`${label} 0.5 seconds earlier`}
        onClick={() => onNudge(-NUDGE_MS)}
        disabled={disabled || value === null}
      >
        −0.5s
      </Button>
      <button
        type="button"
        onClick={onJump}
        disabled={value === null}
        className="min-w-16 text-center text-sm tabular-nums underline-offset-2 hover:underline disabled:no-underline"
        title={`Jump to ${label.toLowerCase()}`}
      >
        <span className="block text-xs text-muted">{label}</span>
        {value === null ? "—" : formatMs(value)}
      </button>
      <Button
        size="lg"
        aria-label={`${label} 0.5 seconds later`}
        onClick={() => onNudge(NUDGE_MS)}
        disabled={disabled || value === null}
      >
        +0.5s
      </Button>
    </div>
  );
}
