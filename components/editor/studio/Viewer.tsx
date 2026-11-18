"use client";
/**
 * Studio viewer: the stitched recording, a seek bar (drag the selected clip's
 * handles, or sweep a new clip's range) and a transport bar.
 */
import { useRef } from "react";
import { Check, ChevronsLeft, ChevronsRight, Brush, Pause, Play, Plus, Undo2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RATING_TONE } from "@/components/app";
import { cn } from "@/lib/cn";
import { clampMs, formatMs, NUDGE_MS } from "@/lib/editor/clipRange";
import type { LineDetail } from "@/lib/types/api";
import { useEditor } from "@/components/shared/editor/context";
import { AnnotationOverlay } from "@/components/shared/annotations/AnnotationOverlay";
import { DrawBar } from "@/components/shared/annotations/DrawBar";
import { DrawLayer } from "@/components/shared/annotations/DrawLayer";
import type { DrawSession } from "@/components/shared/annotations/useDrawSession";
import type { Annotation } from "@/lib/annotations";
import type { Player } from "./usePlayer";
import { MIN_LEN_MS, type Range, type Selection } from "./types";

export function Viewer({
  videoUrl,
  player,
  durationMs,
  title,
  range,
  onNewClip,
  onRangeChange,
  edit,
  status,
  lines,
  selection,
  onSelectClip,
  annotations,
  draw,
  clipBar,
}: {
  videoUrl: string | null;
  player: Player;
  durationMs: number;
  /** e.g. "Left Front Tire · Clip 1". */
  title: string | null;
  range: Range | null;
  /** Start a new clip for the selected issue (null when no issue is selected). */
  onNewClip: (() => void) | null;
  /** Change the selected clip's draft range (from the seek bar). */
  onRangeChange: (r: Range) => void;
  /** Save / Revert for the selected clip's range (null when no clip is selected). */
  edit: EditState | null;
  /** Overlay in the top-right corner of the frame (e.g. sent status). */
  status?: React.ReactNode;
  lines: LineDetail[];
  selection: Selection | null;
  onSelectClip: (lineId: string, clipId: string) => void;
  /** The selected clip's saved drawings (stitched timeline). */
  annotations: readonly Annotation[];
  draw: DrawSession;
  /** The selected saved clip's row (range, drawings, delete); hidden while its range is being edited. */
  clipBar?: React.ReactNode;
}) {
  const drawing = !!draw.state;
  const { now, playing, muted, seek, toggle, toggleMute, current, videoProps, ref } = player;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-t-xl bg-black">
        {videoUrl ? (
          <video
            ref={ref}
            src={videoUrl}
            playsInline
            preload="metadata"
            onClick={drawing ? undefined : toggle}
            className="absolute inset-0 size-full cursor-pointer"
            {...videoProps}
          />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            The video isn&apos;t available.
          </p>
        )}
        {title ? (
          <div className="pointer-events-none absolute top-3 left-3 flex flex-col gap-0.5 rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-white backdrop-blur-sm">
            <span className="font-medium">{title}</span>
            {range ? (
              <span className="font-mono text-white/70 tabular-nums">
                In {formatMs(range.start)} · Out {formatMs(range.end)} · {((range.end - range.start) / 1000).toFixed(1)} s
              </span>
            ) : null}
          </div>
        ) : null}
        {draw.state ? (
          <DrawLayer videoRef={ref} color={draw.state.color} strokes={draw.state.strokes} onChange={draw.setStrokes} />
        ) : (
          <AnnotationOverlay videoRef={ref} annotations={annotations} nowMs={now} />
        )}
        {status ? <div className="absolute top-3 right-3">{status}</div> : null}
        {drawing ? null : <Captions now={now} />}
      </div>

      <div inert={drawing} className={cn("shrink-0", drawing && "opacity-50")}>
        <SeekBar
          player={player}
          durationMs={durationMs}
          range={range}
          editable={!!edit}
          sweeping={!!edit?.isNew}
          onRangeChange={onRangeChange}
          lines={lines}
          selection={selection}
          onSelectClip={onSelectClip}
        />
      </div>

      {drawing ? (
        <div className="overflow-hidden rounded-b-xl">
          <DrawBar draw={draw} />
        </div>
      ) : (
        <>
          <div
            className={cn("flex flex-wrap items-center gap-1 bg-card px-2 py-1.5", !edit?.dirty && !clipBar && "rounded-b-xl")}
          >
            <Tip label="Back 0.5 s" keys="←">
              <Button variant="ghost" size="icon" aria-label="Back 0.5 seconds" onClick={() => seek(current() - NUDGE_MS)}>
                <ChevronsLeft />
              </Button>
            </Tip>
            <Tip label={playing ? "Pause" : "Play"} keys="Space">
              <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={!videoUrl}>
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </Button>
            </Tip>
            <Tip label="Forward 0.5 s" keys="→">
              <Button variant="ghost" size="icon" aria-label="Forward 0.5 seconds" onClick={() => seek(current() + NUDGE_MS)}>
                <ChevronsRight />
              </Button>
            </Tip>
            <span className="mx-2 font-mono text-sm tabular-nums">
              {formatMs(now)}
              <span className="text-muted-foreground"> / {formatMs(durationMs)}</span>
            </span>

            <div className="ml-auto flex items-center gap-1">
              <Tip label={draw.blocked ?? "Draw on the video"} keys="D">
                {/* span: a disabled button gets no hover, so the tooltip still explains why */}
                <span>
                  <Button variant="outline" size="sm" onClick={draw.start} disabled={!!draw.blocked}>
                    <Brush />
                    Draw
                  </Button>
                </span>
              </Tip>
              <Button variant="outline" size="sm" onClick={onNewClip ?? undefined} disabled={!onNewClip || !!edit?.isNew}>
                <Plus />
                New clip
              </Button>
              <Button variant="ghost" size="icon" aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
                {muted ? <VolumeX /> : <Volume2 />}
              </Button>
            </div>
          </div>

          {edit?.dirty ? (
            <EditBar edit={edit} range={range} />
          ) : clipBar ? (
            <div className="overflow-hidden rounded-b-xl">{clipBar}</div>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface EditState {
  isNew: boolean;
  dirty: boolean;
  /** Why the range can't be saved, if it can't. */
  error: string | null;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onRevert: () => void;
}

/** Amber bar under the transport while a range is changed (or a new clip is being made). */
export function EditBar({ edit, range, compact }: { edit: EditState; range: Range | null; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-amber-bg px-3 py-1.5 text-sm text-amber-fg">
      <span className="font-medium">{edit.isNew ? "New clip" : "Range changed"}</span>
      {range ? (
        <span className="font-mono text-xs tabular-nums">
          {formatMs(range.start)} – {formatMs(range.end)}
        </span>
      ) : null}
      {!range ? (
        <span className="text-xs">Drag on the bar {compact ? "below" : "above"} to choose the range.</span>
      ) : edit.error || edit.saveError ? (
        <span className="text-xs text-destructive">{edit.error ?? edit.saveError}</span>
      ) : !edit.isNew && !compact ? (
        <span className="text-xs opacity-80">Saving re-cuts the clip.</span>
      ) : null}
      <div className="ml-auto flex items-center gap-1.5">
        <MaybeTip tip={!compact} label={edit.isNew ? "Cancel the new clip" : "Go back to the saved range"} keys="Esc">
          <Button variant="ghost" size="sm" onClick={edit.onRevert} disabled={edit.saving}>
            <Undo2 />
            {edit.isNew ? "Cancel" : "Revert"}
          </Button>
        </MaybeTip>
        <MaybeTip tip={!compact} label={edit.isNew ? "Add the clip" : "Save the range"} keys="Enter">
          <Button size="sm" onClick={edit.onSave} disabled={edit.saving || !range || !!edit.error}>
            <Check />
            {edit.saving ? "Saving…" : edit.isNew ? "Add clip" : "Save range"}
          </Button>
        </MaybeTip>
      </div>
    </div>
  );
}

function MaybeTip({ tip, label, keys, children }: { tip: boolean; label: string; keys: string; children: React.ReactNode }) {
  return tip ? <Tip label={label} keys={keys}>{children}</Tip> : <>{children}</>;
}

function Tip({ label, keys, children }: { label: string; keys: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

const FLAG_TONE = { red: "bg-red-fg", amber: "bg-amber-fg", green: "bg-green-fg", blue: "bg-blue-fg", gray: "bg-gray-fg" };

/**
 * Seek bar. Flags above it mark where each issue's clips start (colored by
 * rating; click one to select that clip).
 * - Click or drag on the bar to seek.
 * - The selected clip's range is a band with a handle at each end; drag a
 *   handle to change the range.
 * - While making a new clip, dragging on the bar sweeps out its range.
 * The video follows whatever is being dragged so the frame is visible.
 */
export function SeekBar({
  player,
  durationMs,
  range,
  editable,
  sweeping,
  onRangeChange,
  lines,
  selection,
  onSelectClip,
  touch = false,
}: {
  player: Player;
  durationMs: number;
  range: Range | null;
  editable: boolean;
  sweeping: boolean;
  onRangeChange: (r: Range) => void;
  lines: LineDetail[];
  selection: Selection | null;
  onSelectClip: (lineId: string, clipId: string) => void;
  /** Finger-sized grab areas for the range handles. */
  touch?: boolean;
}) {
  const drag = useRef<{ mode: "seek" | "start" | "end" | "sweep"; anchor: number } | null>(null);
  const pct = (ms: number) => `${durationMs > 0 ? Math.min(100, Math.max(0, (ms / durationMs) * 100)) : 0}%`;
  const snap = (ms: number) => clampMs(Math.round(ms / 100) * 100, durationMs);
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return snap(((e.clientX - r.left) / r.width) * durationMs);
  };
  /** Is the pointer within a few pixels of `ms` on the bar? */
  const near = (e: React.PointerEvent<HTMLDivElement>, ms: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.abs(e.clientX - (r.left + (ms / durationMs) * r.width)) <= (touch ? 22 : 8);
  };

  const apply = (ms: number) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "seek") return player.seek(ms);
    if (d.mode === "sweep") {
      onRangeChange({ start: Math.min(d.anchor, ms), end: Math.max(d.anchor, ms) });
    } else if (d.mode === "start" && range) {
      onRangeChange({ start: Math.min(ms, range.end - MIN_LEN_MS), end: range.end });
    } else if (d.mode === "end" && range) {
      onRangeChange({ start: range.start, end: Math.max(ms, range.start + MIN_LEN_MS) });
    }
    player.seek(ms);
  };

  // Flags closer than ~2.5% of the video apart go on a second row so they don't cover each other.
  const gap = durationMs * 0.025;
  const lastOnRow = [-Infinity, -Infinity];
  const flags = lines
    .flatMap((line) => line.clips.map((c) => ({ line, c })))
    .sort((a, b) => a.c.start_ms - b.c.start_ms)
    .map((f) => {
      const row = f.c.start_ms - lastOnRow[0] >= gap ? 0 : f.c.start_ms - lastOnRow[1] >= gap ? 1 : 0;
      lastOnRow[row] = f.c.start_ms;
      return { ...f, row };
    });
  const twoRows = flags.some((f) => f.row === 1);

  return (
    <div className="shrink-0 border-t bg-card px-3 pt-1.5">
      <div className={cn("relative", twoRows ? "h-11" : "h-6")} aria-label="Issues on the video" role="group">
        {flags.map(({ line, c, row }) => {
          const selected = selection?.lineId === line.id;
          const current = selected && selection?.clipId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectClip(line.id, c.id)}
              title={`${line.component_name} · ${formatMs(c.start_ms)} – ${formatMs(c.end_ms)}`}
              aria-label={`Go to ${line.component_name} at ${formatMs(c.start_ms)}`}
              className={cn(
                "absolute bottom-0 flex flex-col items-start transition-opacity hover:z-20 hover:opacity-100",
                selection && !selected && "opacity-60",
                current && "z-10",
              )}
              style={{ left: pct(c.start_ms) }}
            >
              <span
                className={cn(
                  "h-3 w-3.5 rounded-xs rounded-bl-none [clip-path:polygon(0_0,100%_0,75%_50%,100%_100%,0_100%)]",
                  FLAG_TONE[RATING_TONE[line.rating]],
                  current && "h-3.5 w-4",
                )}
              />
              <span className={cn("w-px", row === 1 ? "h-7" : "h-2", FLAG_TONE[RATING_TONE[line.rating]])} />
            </button>
          );
        })}
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={sweeping ? "Drag to choose the new clip's range" : "Seek"}
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(player.now / 1000)}
        aria-valuetext={formatMs(player.now)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ms = at(e);
          const mode =
            editable && range && near(e, range.start)
              ? "start"
              : editable && range && near(e, range.end)
                ? "end"
                : sweeping
                  ? "sweep"
                  : "seek";
          drag.current = { mode, anchor: ms };
          if (mode === "seek") player.seek(ms);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(at(e));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        className={cn(
          "group relative flex touch-none items-center",
          touch ? "h-10" : "h-7",
          sweeping ? "cursor-crosshair" : "cursor-pointer",
        )}
      >
        <div className="relative h-1.5 w-full rounded-full bg-muted transition-[height] group-hover:h-2">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary/50" style={{ width: pct(player.now) }} />
          {range ? (
            <div
              className={cn("absolute -inset-y-1 rounded-sm", editable ? "bg-amber-fg/40 ring-1 ring-amber-fg" : "bg-primary/30")}
              style={{ left: pct(range.start), width: `calc(${pct(range.end)} - ${pct(range.start)})` }}
            />
          ) : null}
          {editable && range ? (
            <>
              <Handle touch={touch} at={pct(range.start)} label={`Start ${formatMs(range.start)}`} />
              <Handle touch={touch} at={pct(range.end)} label={`End ${formatMs(range.end)}`} />
            </>
          ) : null}
          <div
            className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
            style={{ left: pct(player.now) }}
          />
        </div>
      </div>
    </div>
  );
}

function Handle({ at, label, touch }: { at: string; label: string; touch?: boolean }) {
  return (
    <div
      title={label}
      className={cn("absolute top-1/2 flex h-5 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-sm bg-amber-fg shadow-sm", touch && "h-7 w-3.5")}
      style={{ left: at }}
    >
      <span className="h-2.5 w-px bg-black/50" />
    </div>
  );
}

/**
 * Always-on captions, only from the saved transcription (timed to when the
 * words are spoken). No transcript, no captions: nothing is approximated.
 */
export function Captions({ now }: { now: number }) {
  const { data } = useEditor();
  const text = data.transcript.find((t) => now >= t.start_ms && now < t.end_ms)?.text;
  if (!text) return null;
  return (
    <div aria-live="off" className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-6">
      <p className="max-w-[80%] rounded-md bg-black/75 px-3 py-1.5 text-center text-base leading-snug text-white">
        {text}
      </p>
    </div>
  );
}
