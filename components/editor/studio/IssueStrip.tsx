"use client";
/**
 * Under the viewer: one column per issue (report order), with that issue's clips listed underneath.
 * When the selection changes from playback (the playhead reached another flag), the selected
 * issue's column scrolls to the front of the strip and its clip into view. A click in the strip
 * itself doesn't move anything.
 */
import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { RATING_TONE } from "@/components/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/editor/clipRange";
import type { ClipDetail, LineDetail } from "@/lib/types/api";
import { lineWarnings } from "@/components/shared/editor/lineWarnings";
import { scrollIntoList, scrollToFront } from "./scrollToFront";
import { clipKey, clipsByTime, type Range, type Selection } from "./types";

const TONE_DOT = { red: "bg-red-fg", amber: "bg-amber-fg", green: "bg-green-fg", blue: "bg-blue-fg", gray: "bg-gray-fg" };

export function IssueStrip({
  lines,
  selection,
  rangeOf,
  isDirty,
  onSelectClip,
  onSelectLine,
  onAddLine,
}: {
  lines: LineDetail[];
  selection: Selection | null;
  rangeOf: (key: string) => Range | null;
  isDirty: (key: string) => boolean;
  onSelectClip: (lineId: string, clipId: string) => void;
  onSelectLine: (lineId: string) => void;
  onAddLine: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const clickedAtRef = useRef(-Infinity); // a selection change right after a click here came from that click
  const lineId = selection?.lineId ?? null;
  const clipId = selection?.clipId ?? null;

  useEffect(() => {
    if (performance.now() - clickedAtRef.current < 500) return;
    const list = listRef.current;
    if (!list || !lineId) return;
    const col = list.querySelector<HTMLElement>(`[data-line-id="${lineId}"]`);
    if (!col) return;
    scrollToFront(list, col);
    const clips = col.querySelector<HTMLElement>("[data-clips]");
    const row = clipId ? col.querySelector<HTMLElement>(`[data-clip-id="${clipId}"]`) : null;
    if (clips && row) scrollIntoList(clips, row);
  }, [lineId, clipId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-sm font-medium">Issues</span>
        <span className="text-xs text-muted-foreground tabular-nums">{lines.length}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onAddLine}>
          <Plus /> Add issue
        </Button>
      </div>
      <ol ref={listRef} className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {lines.map((line) => {
          const selected = selection?.lineId === line.id;
          const warnings = lineWarnings(line).length;
          return (
            <li
              key={line.id}
              data-line-id={line.id}
              className={cn(
                "flex w-56 shrink-0 flex-col overflow-hidden rounded-lg border bg-background",
                selected && "border-primary",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  clickedAtRef.current = performance.now();
                  onSelectLine(line.id);
                }}
                aria-pressed={selected}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                  selected && "bg-accent",
                )}
              >
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[RATING_TONE[line.rating]])} />
                <span className="min-w-0 flex-1 truncate font-medium">{line.component_name}</span>
                {warnings ? (
                  <AlertTriangle
                    aria-label={`${warnings} warning${warnings === 1 ? "" : "s"}`}
                    className="size-3.5 shrink-0 text-amber-fg"
                  />
                ) : null}
              </button>
              <div data-clips className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5">
                {clipsByTime(line).map((c, i) => {
                  const key = clipKey(line.id, c.id);
                  return (
                    <ClipRow
                      key={c.id}
                      clip={c}
                      n={i + 1}
                      range={rangeOf(key)!}
                      dirty={isDirty(key)}
                      selected={selected && selection?.clipId === c.id}
                      onClick={() => {
                        clickedAtRef.current = performance.now();
                        onSelectClip(line.id, c.id);
                      }}
                    />
                  );
                })}
                {line.clips.length === 0 ? (
                  <p className="px-1.5 py-1 text-xs text-muted-foreground">No clip yet</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ClipRow({
  clip,
  n,
  range,
  dirty,
  selected,
  onClick,
}: {
  clip: ClipDetail;
  /** Number by time within the issue. */
  n: number;
  range: Range;
  dirty: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-clip-id={clip.id}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-2 rounded-md p-1 text-left text-xs transition-colors hover:bg-accent",
        selected && "bg-accent ring-1 ring-primary",
      )}
    >
      {clip.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- proxied media
        <img src={clip.thumbnail_url} alt="" className="media aspect-video w-16 shrink-0 rounded-sm" />
      ) : (
        <span className="aspect-video w-16 shrink-0 rounded-sm bg-muted" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1 font-medium">
          Clip {n}
          {clip.status === "pending" ? <Loader2 aria-label="Cutting" className="size-3 animate-spin" /> : null}
          {clip.status === "failed" ? <AlertTriangle aria-label="Couldn't cut" className="size-3 text-red-fg" /> : null}
          {dirty ? <span className="text-amber-fg">· unsaved</span> : null}
        </span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatMs(range.start)}–{formatMs(range.end)}
        </span>
      </span>
    </button>
  );
}
