"use client";
/**
 * Clip panel for one line: pick a clip (or add one), adjust its range on the
 * stitched video, choose its thumbnail, reorder or delete it.
 * On phones it covers the screen; on laptops it's the right-hand column.
 */
import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatMs, rangeError } from "@/lib/editor/clipRange";
import { apiSend } from "@/lib/fetcher";
import type { ClipDetail, LineDetail } from "@/lib/types/api";
import { useAction, useEditor } from "./context";
import { InlineConfirm } from "./InlineConfirm";
import { RangeEditor, type Range } from "./RangeEditor";

export type ClipSelection = string | "new";

export function ClipStatus({ clip }: { clip: ClipDetail }) {
  if (clip.status === "ready") return <Badge tone="green">Ready</Badge>;
  if (clip.status === "pending") return <Badge tone="blue">Cutting…</Badge>;
  return <Badge tone="red">Couldn&apos;t cut</Badge>;
}

export function ClipPanel({
  line,
  selected,
  onSelect,
  onClose,
}: {
  line: LineDetail;
  selected: ClipSelection;
  onSelect: (s: ClipSelection) => void;
  onClose: () => void;
}) {
  const clip = selected === "new" ? null : (line.clips.find((c) => c.id === selected) ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">Clips for</p>
          <h2 className="truncate text-lg font-semibold">{line.component_name}</h2>
        </div>
        <Button size="lg" onClick={onClose}>
          Done
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Clips">
        {line.clips.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === selected}
            onClick={() => onSelect(c.id)}
            className={cn(
              "flex h-12 items-center gap-2 rounded-md border px-3 text-sm font-medium",
              c.id === selected ? "border-2 border-foreground bg-surface" : "border-border hover:bg-surface-hover",
            )}
          >
            Clip {c.position}
            {c.position === 1 ? <span className="text-muted">· Main</span> : null}
            {c.status !== "ready" ? (
              <span className={c.status === "failed" ? "text-red-fg" : "text-blue-fg"}>
                · {c.status === "failed" ? "Failed" : "Cutting"}
              </span>
            ) : null}
          </button>
        ))}
        <button
          role="tab"
          aria-selected={selected === "new"}
          onClick={() => onSelect("new")}
          className={cn(
            "h-12 rounded-md border border-dashed px-3 text-sm font-medium",
            selected === "new" ? "border-2 border-foreground bg-surface" : "border-border-strong hover:bg-surface-hover",
          )}
        >
          + Add clip
        </button>
      </div>

      {selected === "new" ? (
        <NewClip key={`new-${line.id}`} line={line} onCreated={onSelect} />
      ) : clip ? (
        <ClipEditor key={clip.id} line={line} clip={clip} onDeleted={() => onSelect(line.clips.find((c) => c.id !== clip.id)?.id ?? "new")} />
      ) : (
        <p className="text-sm text-muted">That clip no longer exists.</p>
      )}
    </div>
  );
}

function NewClip({ line, onCreated }: { line: LineDetail; onCreated: (id: string) => void }) {
  const { data } = useEditor();
  const [range, setRange] = useState<Range>({ start: null, end: null });
  const { run, busy, error } = useAction();
  const duration = data.inspection.duration_ms ?? 0;
  const valid = range.start !== null && range.end !== null && !rangeError(range.start, range.end, duration);
  // Start near the line's evidence, if any.
  const seekTo = line.mentions[0]?.visible_start_ms ?? line.clips.at(-1)?.end_ms ?? 0;

  if (!data.video_url) return <p className="text-sm text-muted">The video isn&apos;t available.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Find the moment in the video, then set where the new clip starts and ends.</p>
      <RangeEditor
        videoUrl={data.video_url}
        durationMs={duration}
        pausePointsMs={data.pause_points_ms}
        value={range}
        onChange={setRange}
        initialSeekMs={seekTo}
      />
      <Button
        variant="primary"
        size="lg"
        full
        disabled={!valid || busy}
        onClick={() =>
          run(async () => {
            const res = await apiSend<{ id: string }>(`/api/lines/${line.id}/clips`, "POST", {
              start_ms: range.start,
              end_ms: range.end,
            });
            onCreated(res.id);
          })
        }
      >
        {busy ? "Adding…" : "Add clip"}
      </Button>
      {error ? <p className="text-sm text-red-fg">{error}</p> : null}
    </div>
  );
}

function ClipEditor({ line, clip, onDeleted }: { line: LineDetail; clip: ClipDetail; onDeleted: () => void }) {
  const { data, holdPolling } = useEditor();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [range, setRange] = useState<Range>({ start: clip.start_ms, end: clip.end_ms });
  const save = useAction();
  const thumb = useAction();
  const frame = useAction();
  const move = useAction();
  const del = useAction();
  const duration = data.inspection.duration_ms ?? 0;

  // "Use current frame" is async (worker job): wait for a new frame to show up.
  const [waitingFrame, setWaitingFrame] = useState<{ known: Set<string> } | null>(null);
  const [frameNote, setFrameNote] = useState<string | null>(null);
  const waiting = !!waitingFrame && !clip.frames.some((f) => !waitingFrame.known.has(f.id));
  useEffect(() => {
    if (!waiting) return;
    const release = holdPolling();
    const t = setTimeout(() => {
      setWaitingFrame(null);
      setFrameNote("That frame is taking a while. It will show up here when it's ready.");
    }, 60_000);
    return () => {
      clearTimeout(t);
      release();
    };
  }, [waiting, holdPolling]);

  const changed = range.start !== clip.start_ms || range.end !== clip.end_ms;
  const err = range.start !== null && range.end !== null ? rangeError(range.start, range.end, duration) : "Set a start and an end.";
  const ids = line.clips.map((c) => c.id);
  const idx = ids.indexOf(clip.id);

  const reorder = (to: number) =>
    move.run(() => {
      const next = [...ids];
      next.splice(idx, 1);
      next.splice(to, 0, clip.id);
      return apiSend(`/api/lines/${line.id}/clips/reorder`, "POST", { ids: next });
    });

  if (!data.video_url) return <p className="text-sm text-muted">The video isn&apos;t available.</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ClipStatus clip={clip} />
        <span className="text-muted tabular-nums">
          Saved range {formatMs(clip.start_ms)} – {formatMs(clip.end_ms)}
        </span>
        {clip.mention_id === null ? <Badge>Added by you</Badge> : null}
      </div>
      {clip.status === "failed" ? (
        <div className="flex flex-col gap-2 rounded-md border border-red-border bg-red-bg p-3 text-sm text-red-fg">
          <p>This clip couldn&apos;t be cut. Try again, or change the range and save.</p>
          <Button
            size="lg"
            disabled={save.busy}
            onClick={() =>
              save.run(() => apiSend(`/api/clips/${clip.id}`, "PATCH", { start_ms: clip.start_ms, end_ms: clip.end_ms }))
            }
          >
            Retry cut
          </Button>
        </div>
      ) : null}

      <RangeEditor
        videoUrl={data.video_url}
        durationMs={duration}
        pausePointsMs={data.pause_points_ms}
        value={range}
        onChange={setRange}
        videoRef={videoRef}
        initialSeekMs={clip.start_ms}
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          size="lg"
          className="sm:flex-1"
          disabled={!changed || !!err || save.busy}
          onClick={() => save.run(() => apiSend(`/api/clips/${clip.id}`, "PATCH", { start_ms: range.start, end_ms: range.end }))}
        >
          {save.busy ? "Saving…" : "Save range"}
        </Button>
        <Button size="lg" disabled={!changed || save.busy} onClick={() => setRange({ start: clip.start_ms, end: clip.end_ms })}>
          Undo changes
        </Button>
      </div>
      {changed && !err ? <p className="text-sm text-muted">Saving re-cuts the clip. It takes a few seconds.</p> : null}
      {save.error ? <p className="text-sm text-red-fg">{save.error}</p> : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Photo for this clip</h3>
          <Button
            size="lg"
            disabled={frame.busy || waiting}
            onClick={() => {
              const ms = Math.round((videoRef.current?.currentTime ?? 0) * 1000);
              setFrameNote(null);
              if (ms < clip.start_ms || ms > clip.end_ms) {
                setFrameNote(
                  `Move the playhead inside this clip's saved range (${formatMs(clip.start_ms)} – ${formatMs(clip.end_ms)}) first.`,
                );
                return;
              }
              const known = new Set(clip.frames.map((f) => f.id));
              void frame
                .run(() => apiSend(`/api/clips/${clip.id}/frames`, "POST", { timestamp_ms: ms }))
                .then((ok) => ok && setWaitingFrame({ known }));
            }}
          >
            {waiting ? "Getting frame…" : "Use current frame"}
          </Button>
        </div>
        {frame.error ? <p className="text-sm text-red-fg">{frame.error}</p> : null}
        {frameNote ? <p className="text-sm text-muted">{frameNote}</p> : null}
        {clip.frames.length === 0 ? (
          <p className="text-sm text-muted">
            {clip.status === "pending" ? "Photos appear once the clip is cut." : "No photos yet."}
          </p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {clip.frames.map((f) => {
              const on = f.id === clip.thumbnail_frame_id;
              return (
                <li key={f.id} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={thumb.busy}
                    onClick={() => !on && thumb.run(() => apiSend(`/api/clips/${clip.id}`, "PATCH", { thumbnail_frame_id: f.id }))}
                    className={cn(
                      "flex w-32 flex-col gap-1 rounded-md border p-1 text-left",
                      on ? "border-2 border-foreground" : "border-border hover:bg-surface-hover",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- proxied media, sizes unknown */}
                    <img src={f.url} alt={`Frame at ${formatMs(f.timestamp_ms)}`} className="media h-20 w-full rounded-sm" />
                    <span className="flex items-center justify-between gap-1 px-0.5 text-xs tabular-nums">
                      <span className="text-muted">{formatMs(f.timestamp_ms)}</span>
                      {on ? <span className="font-medium">✓ Chosen</span> : f.origin === "tech_picked" ? <span className="text-muted">Yours</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {thumb.error ? <p className="text-sm text-red-fg">{thumb.error}</p> : null}
        {clip.position === 1 ? <p className="text-xs text-muted">The main clip&apos;s photo is the line&apos;s photo.</p> : null}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Clip order</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" disabled={idx <= 0 || move.busy} onClick={() => reorder(idx - 1)}>
            ↑ Earlier
          </Button>
          <Button size="lg" disabled={idx >= ids.length - 1 || move.busy} onClick={() => reorder(idx + 1)}>
            ↓ Later
          </Button>
          {idx > 0 ? (
            <Button size="lg" disabled={move.busy} onClick={() => reorder(0)}>
              Make main clip
            </Button>
          ) : null}
        </div>
        {move.error ? <p className="text-sm text-red-fg">{move.error}</p> : null}
        <InlineConfirm
          trigger="Delete this clip"
          triggerVariant="secondary"
          message={
            line.clips.length === 1
              ? "Delete this clip? It's the line's only clip; you'll need to add another before sending."
              : "Delete this clip?"
          }
          confirmLabel="Delete clip"
          busy={del.busy}
          onConfirm={async () => {
            if (await del.run(() => apiSend(`/api/clips/${clip.id}`, "DELETE"))) onDeleted();
          }}
        />
        {del.error ? <p className="text-sm text-red-fg">{del.error}</p> : null}
      </section>
    </div>
  );
}
