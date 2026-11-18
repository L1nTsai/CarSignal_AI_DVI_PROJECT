"use client";
/**
 * Phone editor: one screen, no page scroll.
 *
 *   ┌────────────────────┐
 *   │ video (always)     │
 *   │ play · Draw · New  │
 *   ├────────────────────┤
 *   │ one of:            │   Timeline: seek bar + issue section
 *   │  Timeline          │   Details: customer, issue, clip
 *   │  Details           │   Photo: thumbnail picker
 *   │  Photo             │   Transcript
 *   │  Transcript        │
 *   ├────────────────────┤
 *   │ bottom tab bar     │
 *   └────────────────────┘
 *
 * All state (selection, drafts, saving) lives in <Studio>; this is layout only.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Brush, Camera, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardList, Film, Loader2, MessageSquareText, Pause, Pencil, Check, Play, Plus, Volume2, VolumeX } from "lucide-react";
import { RATING_TONE } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { scrollToFront } from "./scrollToFront";
import { formatMs, NUDGE_MS } from "@/lib/editor/clipRange";
import type { ClipDetail, LineDetail } from "@/lib/types/api";
import { useEditor } from "@/components/shared/editor/context";
import { lineWarnings } from "@/components/shared/editor/lineWarnings";
import { Captions, EditBar, SeekBar, type EditState } from "./Viewer";
import { insideDialog } from "./ClipBar";
import { DeleteClip, DrawingsSection, SidePanel } from "./SidePanel";
import { AnnotationOverlay } from "@/components/shared/annotations/AnnotationOverlay";
import { DrawBar } from "@/components/shared/annotations/DrawBar";
import { DrawLayer } from "@/components/shared/annotations/DrawLayer";
import type { DrawSession } from "@/components/shared/annotations/useDrawSession";
import type { Player } from "./usePlayer";
import { clipKey, clipNumber, clipsByTime, type Range, type Selection } from "./types";

const TONE_DOT = { red: "bg-red-fg", amber: "bg-amber-fg", green: "bg-green-fg", blue: "bg-blue-fg", gray: "bg-gray-fg" };

export interface MobileStudioProps {
  player: Player;
  durationMs: number;
  lines: LineDetail[];
  selection: Selection | null;
  line: LineDetail | undefined;
  clip: ClipDetail | undefined;
  range: Range | null;
  edit: EditState | null;
  title: string | null;
  status: React.ReactNode;
  rangeOf: (key: string) => Range | null;
  isDirty: (key: string) => boolean;
  draw: DrawSession;
  onSelectClip: (lineId: string, clipId: string | "new" | null) => void;
  onSelectLine: (lineId: string) => void;
  onNewClip: (lineId: string) => void;
  onRangeChange: (r: Range) => void;
  onAddLine: () => void;
}

type Tab = "timeline" | "details" | "thumbnail" | "transcript";
const TABS: { id: Tab; label: string; icon: typeof Film }[] = [
  { id: "timeline", label: "Timeline", icon: Film },
  { id: "details", label: "Details", icon: ClipboardList },
  { id: "thumbnail", label: "Photo", icon: Camera },
  { id: "transcript", label: "Transcript", icon: MessageSquareText },
];

export function MobileStudio(p: MobileStudioProps) {
  const [tab, setTab] = useState<Tab>("timeline");
  // Range handles only show while the selected clip is being edited (Edit button).
  const [editKey, setEditKey] = useState<string | null>(null);
  const selKey = p.selection?.clipId ? clipKey(p.selection.lineId, p.selection.clipId) : null;
  const editing = editKey !== null && editKey === selKey;
  // The time span of the current issue's clips: the transcript tab shows just that part.
  const issueWindow =
    p.line && p.line.clips.length > 0
      ? { start: Math.min(...p.line.clips.map((c) => c.start_ms)), end: Math.max(...p.line.clips.map((c) => c.end_ms)) }
      : null;
  const { player, durationMs, lines, selection, range, edit, title, status, isDirty, draw } = p;
  const drawing = !!draw.state;
  const { data } = useEditor();
  const { now, playing, muted, seek, toggle, toggleMute, current, videoProps, ref } = player;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* The video is always here; only the panel under it changes. While drawing, this same box
          (same <video>, so the player keeps its element) fills the screen; Save or Cancel brings it back. */}
      <div
        className={cn(
          drawing
            ? "fixed inset-0 z-50 flex flex-col bg-black pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
            : "shrink-0 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10",
        )}
      >
        <div className={cn("relative bg-black", drawing && "min-h-0 flex-1")}>
          {data.video_url ? (
            <video
              ref={ref}
              src={data.video_url}
              playsInline
              preload="metadata"
              onClick={drawing ? undefined : toggle}
              className={cn(
                "block w-full object-contain",
                drawing ? "absolute inset-0 h-full" : "max-h-[34dvh] min-h-32",
              )}
              {...videoProps}
            />
          ) : (
            <p className="flex h-32 items-center justify-center text-sm text-white/70">The video isn&apos;t available.</p>
          )}
          {title ? (
            <div className="pointer-events-none absolute top-2 left-2 flex max-w-[70%] flex-col rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm">
              <span className="truncate font-medium">{title}</span>
              {range ? (
                <span className="font-mono text-[11px] text-white/70 tabular-nums">
                  {formatMs(range.start)} – {formatMs(range.end)}
                </span>
              ) : null}
            </div>
          ) : null}
          {draw.state ? (
            <DrawLayer videoRef={ref} color={draw.state.color} strokes={draw.state.strokes} onChange={draw.setStrokes} />
          ) : (
            <AnnotationOverlay videoRef={ref} annotations={p.clip?.annotations ?? []} nowMs={now} />
          )}
          {status && !drawing ? <div className="absolute top-2 right-2">{status}</div> : null}
          {drawing ? null : <Captions now={now} />}
        </div>

        {drawing ? <DrawBar compact draw={draw} /> : null}
        <div className={cn("flex items-center gap-0.5 px-1.5 py-1", drawing && "hidden")}>
          <Button variant="ghost" size="icon" aria-label="Back 0.5 seconds" onClick={() => seek(current() - NUDGE_MS)}>
            <ChevronsLeft />
          </Button>
          <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={!data.video_url}>
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Forward 0.5 seconds" onClick={() => seek(current() + NUDGE_MS)}>
            <ChevronsRight />
          </Button>
          <span className="mx-1.5 whitespace-nowrap font-mono text-xs tabular-nums">
            {formatMs(now)}
            <span className="text-muted-foreground max-[420px]:hidden"> / {formatMs(durationMs)}</span>
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="outline" size="sm" onClick={draw.start} disabled={!!draw.blocked} title={draw.blocked ?? undefined}>
              <Brush />
              Draw
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!p.line || edit?.isNew}
              onClick={() => p.line && p.onNewClip(p.line.id)}
            >
              <Plus />
              New clip
            </Button>
            <Button variant="ghost" size="icon" aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>
          </div>
        </div>
        {edit?.dirty && !drawing ? <EditBar compact edit={edit} range={range} /> : null}
      </div>

      <div
        inert={drawing}
        className={cn("min-h-0 flex-1 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10", drawing && "opacity-50")}
      >
        <div className="flex h-full min-h-0 flex-col">
          <SeekBar
            touch
            player={player}
            durationMs={durationMs}
            range={range}
            editable={!!edit && (editing || edit.isNew || edit.dirty)}
            sweeping={!!edit?.isNew}
            onRangeChange={p.onRangeChange}
            lines={lines}
            selection={selection}
            onSelectClip={p.onSelectClip}
          />
          <IssueHeader lines={lines} selection={selection} onSelectLine={p.onSelectLine} onAddLine={p.onAddLine} />
          {tab === "timeline" ? (
            <IssueSection
              lines={lines}
              selection={selection}
              isDirty={isDirty}
              rangeOf={p.rangeOf}
              editing={editing}
              onEditingChange={(on) => setEditKey(on ? selKey : null)}
              onSelectClip={p.onSelectClip}
              onAddLine={p.onAddLine}
              player={player}
            />
          ) : (
            <div className="min-h-0 flex-1 border-t">
              <SidePanel
                hideTabs
                hideVehicle
                tab={tab}
                selection={selection}
                line={p.line}
                clip={p.clip}
                player={player}
                onSelectClip={p.onSelectClip}
                onBeginNewClip={p.onNewClip}
                transcriptWindow={issueWindow}
              />
            </div>
          )}
        </div>
      </div>

      <nav
        aria-label="Editor sections"
        inert={drawing}
        className={cn("grid shrink-0 grid-cols-4 rounded-xl bg-muted p-0.5", drawing && "opacity-50")}
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
            className={cn(
              "flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium transition-colors",
              tab === id ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Which issue we're on (color, name, "n of m", arrows). Shown on every tab; it follows the video. */
function IssueHeader({
  lines,
  selection,
  onSelectLine,
  onAddLine,
}: Pick<MobileStudioProps, "lines" | "selection" | "onSelectLine" | "onAddLine">) {
  const idx = Math.max(0, lines.findIndex((l) => l.id === selection?.lineId));
  const l = lines[idx];
  if (!l) return null;
  return (
    <div className="shrink-0 border-t px-2 py-1">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous issue"
          disabled={idx === 0}
          onClick={() => onSelectLine(lines[idx - 1].id)}
        >
          <ChevronLeft />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <span className="flex max-w-full items-center gap-2 text-sm font-semibold">
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", TONE_DOT[RATING_TONE[l.rating]])} />
            <span className="truncate">{l.component_name}</span>
            {lineWarnings(l).length > 0 ? (
              <AlertTriangle aria-label="Has warnings" className="size-3.5 shrink-0 text-amber-fg" />
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            Issue {idx + 1} of {lines.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next issue"
          disabled={idx >= lines.length - 1}
          onClick={() => onSelectLine(lines[idx + 1].id)}
        >
          <ChevronRight />
        </Button>
        <Button variant="outline" size="icon" aria-label="New issue" title="New issue" onClick={onAddLine}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

/**
 * One issue section, reused for every issue: the clips row just swaps its
 * contents. New clip lives in the video controls and New issue in the header.
 * The studio selects the issue whose flag the playhead passes, so this follows
 * the video; the arrows step through issues by hand.
 */
function IssueSection({
  lines,
  selection,
  isDirty,
  rangeOf,
  onSelectClip,
  onAddLine,
  editing,
  onEditingChange,
  player,
}: Pick<
  MobileStudioProps,
  "lines" | "selection" | "isDirty" | "rangeOf" | "onSelectClip" | "onAddLine"
> & { editing: boolean; onEditingChange: (on: boolean) => void; player: Player }) {
  const idx = Math.max(0, lines.findIndex((l) => l.id === selection?.lineId));
  const l = lines[idx];
  const selClip = l && selection?.clipId && selection.clipId !== "new" ? l.clips.find((c) => c.id === selection.clipId) : undefined;

  // Playback reached another clip: bring its card to the front of the row (not after a tap here).
  const clipRowRef = useRef<HTMLUListElement>(null);
  const tappedAtRef = useRef(-Infinity); // a change right after a tap here came from that tap
  const selClipId = selClip?.id ?? null;
  useEffect(() => {
    if (performance.now() - tappedAtRef.current < 500) return;
    const row = clipRowRef.current;
    const card = selClipId ? row?.querySelector<HTMLElement>(`[data-clip-id="${selClipId}"]`) : null;
    if (row && card) scrollToFront(row, card);
  }, [selClipId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2.5 py-2">
      {l ? (
        <>
          {l.clips.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clip yet. Tap New clip above, then drag on the bar.</p>
          ) : (
            <ul
              ref={clipRowRef}
              className="-mx-2.5 flex gap-2 overflow-x-auto overscroll-x-contain px-2.5 [scrollbar-width:none]"
            >
              {clipsByTime(l).map((c, i) => {
                const key = clipKey(l.id, c.id);
                const r = rangeOf(key);
                const selected = selection?.clipId === c.id;
                return (
                  <li key={c.id} data-clip-id={c.id} className="w-32 min-w-32 max-w-32 shrink-0">
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`Go to clip ${i + 1}`}
                      onClick={() => {
                        tappedAtRef.current = performance.now();
                        onSelectClip(l.id, c.id);
                      }}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-lg border p-1 text-left text-xs transition-colors",
                        selected ? "border-primary bg-accent ring-1 ring-primary" : "hover:bg-accent",
                      )}
                    >
                      <span className="relative block aspect-video overflow-hidden rounded-md bg-muted">
                        {c.thumbnail_url ? (
                          // Positioned to fill the box: iPhone Safari ignores height:100% on an image inside an
                          // aspect-ratio box, which showed a portrait frame zoomed in on its top.
                          // eslint-disable-next-line @next/next/no-img-element -- proxied media
                          <img src={c.thumbnail_url} alt="" className="media absolute inset-0 size-full" />
                        ) : null}
                        {c.status !== "ready" ? (
                          <span className="absolute inset-0 flex items-center justify-center gap-1 bg-black/60 text-white">
                            {c.status === "failed" ? (
                              <>
                                <AlertTriangle className="size-3.5" /> Couldn&apos;t cut
                              </>
                            ) : (
                              <>
                                <Loader2 className="size-3.5 animate-spin" /> Cutting…
                              </>
                            )}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-col px-0.5">
                        <span className="flex items-center gap-1 font-medium whitespace-nowrap">
                          Clip {i + 1}
                          {isDirty(key) ? <span className="ml-auto text-amber-fg">•</span> : null}
                        </span>
                        {r ? (
                          <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
                            {formatMs(r.start)}–{formatMs(r.end)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selClip ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-2 py-1">
              <span className="mr-auto text-sm font-medium">Clip {clipNumber(l, selClip.id)}</span>
              {/* Drawings: only when the clip has some, and in a popup, so the list doesn't take room here. */}
              {selClip.annotations.length > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" aria-label={`Drawings (${selClip.annotations.length})`}>
                      <Brush />
                      {selClip.annotations.length}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-[min(20rem,calc(100vw-2rem))]"
                    onInteractOutside={insideDialog}
                    onFocusOutside={insideDialog}
                  >
                    <DrawingsSection clip={selClip} player={player} hideWhenEmpty />
                  </PopoverContent>
                </Popover>
              ) : null}
              <Button
                size="sm"
                variant={editing ? "default" : "outline"}
                aria-pressed={editing}
                onClick={() => onEditingChange(!editing)}
              >
                {editing ? <Check /> : <Pencil />}
                {editing ? "Done editing" : "Edit"}
              </Button>
              <DeleteClip
                key={selClip.id}
                line={l}
                clip={selClip}
                n={clipNumber(l, selClip.id)}
                onDeleted={(next) => onSelectClip(l.id, next)}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">No issues yet.</p>
          <Button variant="outline" onClick={onAddLine}>
            <Plus />
            New issue
          </Button>
        </div>
      )}
    </div>
  );
}
