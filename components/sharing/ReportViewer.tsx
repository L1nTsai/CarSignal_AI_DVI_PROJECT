"use client";
/**
 * The customer's report as a player and a panel.
 *
 *   laptop (fills the window)      phone (ReportMobile)
 *   ┌───────────────┬──────────┐   ┌──────────────┐
 *   │ player        │ car      │   │ player       │
 *   │ (fills)       │ filter   │   ├──────────────┤
 *   │               │ issues ↕ │   │ issues ↕     │
 *   │ ‹ name ›      │          │   │              │
 *   └───────────────┴──────────┘   └──────────────┘
 *
 * The car diagram and the filter chips stay put at the top of the issues panel;
 * only the issue cards scroll under them. On the phone there is no list: one card
 * shows the playing issue and switches as playback moves to a new issue. When playback moves to another issue
 * (a clip ended, or a spot on the car was tapped), that issue's card jumps to
 * the top of the list. Tapping a card doesn't move it.
 *
 * The player goes through the clips one by one, in the order of the issues in
 * the panel (Needs attention, then Monitor, then Good). When a clip ends the
 * next one starts, moving on to the next issue after an issue's last clip. Tap
 * an issue to play from its first clip. Once the customer has pressed play,
 * following clips start by themselves; before that nothing autoplays.
 *
 * The tech's drawings show over the playing clip (AnnotationOverlay). The car
 * diagram (CarMap) sits at the top of the issues panel, on laptop and phone.
 *
 * Customer-facing: only ShareLine fields reach this component.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RatingBadge, RATING_TONE } from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnnotationOverlay } from "@/components/shared/annotations/AnnotationOverlay";
import { CarMap } from "./CarMap";
import { cn } from "@/lib/cn";
import { RATING_LABEL, RATING_ORDER, groupByRating } from "@/lib/ratings";
import type { LineChangeBadge } from "@/lib/sharing/diff";
import type { ShareLine } from "@/lib/types/api";
import type { LineRating } from "@/lib/types/db";

type Filter = "all" | LineRating;
/** Highlight for the current issue: the rating's own color instead of white. */
const TONE_ON = {
  red: "border-red-border bg-red-bg text-red-fg",
  amber: "border-amber-border bg-amber-bg text-amber-fg",
  green: "border-green-border bg-green-bg text-green-fg",
  blue: "border-blue-border bg-blue-bg text-blue-fg",
  gray: "border-gray-border bg-gray-bg text-gray-fg",
};
const DOT = { red: "bg-red-fg", amber: "bg-amber-fg", green: "bg-green-fg", blue: "bg-blue-fg", gray: "bg-gray-fg" };

export function useReportPlayer(lines: ShareLine[]) {
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState<{ key: string; clip: number } | null>(null);
  // Set once the customer presses play: from then on the next clip starts by itself.
  const [started, setStarted] = useState(false);

  const counts = RATING_ORDER.map((r) => [r, lines.filter((l) => l.rating === r).length] as const).filter(([, n]) => n > 0);
  const groups = groupByRating(lines).filter((g) => filter === "all" || g.rating === filter);
  const ordered = groups.flatMap((g) => g.lines);

  // Where we are, kept valid when the filter changes.
  const lineIdx = Math.max(0, ordered.findIndex((l) => l.key === active?.key));
  const line = ordered[lineIdx];
  const clipIdx = line && active?.key === line.key ? Math.min(active.clip, Math.max(0, line.clips.length - 1)) : 0;
  const clip = line?.clips[clipIdx];

  const go = (key: string, clip: number) => setActive({ key, clip });
  // Previous / next clip across all the (visible) issues.
  const step = (dir: 1 | -1) => {
    if (!line) return false;
    const c = clipIdx + dir;
    if (c >= 0 && c < line.clips.length) return go(line.key, c), true;
    for (let i = lineIdx + dir; i >= 0 && i < ordered.length; i += dir) {
      const n = ordered[i].clips.length;
      if (n > 0) return go(ordered[i].key, dir === 1 ? 0 : n - 1), true;
    }
    return false;
  };
  const total = ordered.reduce((n, l) => n + l.clips.length, 0);
  const position = ordered.slice(0, lineIdx).reduce((n, l) => n + l.clips.length, 0) + clipIdx + 1;

  return { lines, filter, setFilter, counts, groups, line, clip, clipIdx, go, step, total, position, started, setStarted };
}

export type ReportPlayer = ReturnType<typeof useReportPlayer>;

/** The video and its caption row (issue name, clip n of m, previous / next). */
export function PlayerPane({ r, videoClass, fill = false }: { r: ReportPlayer; videoClass?: string; fill?: boolean }) {
  const { line, clip, clipIdx, step, total, position, started, setStarted } = r;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  return (
    <>
      <div className={cn("relative overflow-hidden rounded-xl bg-black", fill && "min-h-0 flex-1")}>
        {clip ? (
          <video
            ref={videoRef}
            key={clip.clip_url}
            src={clip.clip_url}
            poster={clip.thumbnail_url}
            controls
            playsInline
            autoPlay={started}
            onPlay={() => setStarted(true)}
            onEnded={() => step(1)}
            className={cn("w-full object-contain", fill ? "absolute inset-0 h-full" : "block min-h-40", videoClass)}
          />
        ) : (
          <p className={cn("flex items-center justify-center text-sm text-white/70", fill ? "h-full" : "h-40")}>
            No video for this issue.
          </p>
        )}
        {/* Own key (not the video's: same-key siblings duplicate the player); remounts per clip. */}
        {clip ? <AnnotationOverlay key={`overlay:${clip.clip_url}`} videoRef={videoRef} annotations={clip.annotations ?? []} /> : null}
      </div>

      {line ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous clip" onClick={() => step(-1)} disabled={position <= 1}>
            <ChevronLeft />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col items-center text-center">
            <span className="flex max-w-full items-center gap-2 text-sm font-semibold">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[RATING_TONE[line.rating]])} />
              <span className="truncate">{line.component_name}</span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              Clip {clipIdx + 1} of {line.clips.length} · {position} of {total} overall
            </span>
          </div>
          <Button variant="outline" size="icon" aria-label="Next clip" onClick={() => step(1)} disabled={position >= total}>
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * The car and filter chips (fixed) over the issues grouped by rating (scrolls), or, with `single`
 * (phone), over just the playing issue's card.
 * Fills its parent's height: the parent must be a flex column with a bounded height.
 */
export function IssuePanel({
  r,
  badges,
  compact = false,
  single = false,
}: {
  r: ReportPlayer;
  badges: Record<string, LineChangeBadge>;
  /** Phone: a smaller car, so the issue card keeps its room. */
  compact?: boolean;
  /** Phone: no list and no filter chips, just the playing issue's card, which switches as the clips move to a new issue. */
  single?: boolean;
}) {
  const { lines, filter, setFilter, counts, groups, line, clipIdx, go } = r;
  const listRef = useRef<HTMLDivElement>(null);
  const tappedAtRef = useRef(-Infinity); // a change right after a tap on a card came from that tap
  const key = line?.key ?? null;
  useEffect(() => {
    if (!key || performance.now() - tappedAtRef.current < 500) return;
    const list = listRef.current;
    const card = list?.querySelector<HTMLElement>(`[data-issue-key="${CSS.escape(key)}"]`);
    if (!card || !list) return;
    const top = card.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 8;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [key]);
  /** A tap on a card: play it where it is (event.timeStamp is on performance.now()'s clock). */
  const tap = (e: React.MouseEvent, k: string, clip: number) => {
    tappedAtRef.current = e.timeStamp;
    go(k, clip);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3">
        <CarMap r={r} compact={compact} className={compact ? "border-b pb-2" : "border-b pb-3"} />
        {single ? null : (
          <div role="group" aria-label="Filter issues" className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              <Badge variant="gray" size="lg">
                All {lines.length}
              </Badge>
            </Chip>
            {counts.map(([rating, n]) => (
              <Chip key={rating} active={filter === "all" || filter === rating} onClick={() => setFilter(filter === rating ? "all" : rating)}>
                <Badge variant={RATING_TONE[rating]} size="lg">
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                  {RATING_LABEL[rating]} {n}
                </Badge>
              </Chip>
            ))}
          </div>
        )}
      </div>

      {single ? (
        <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1 pb-1">
          {line ? (
            // key: a new issue is a new card, which fades in.
            <div key={line.key} className="animate-in fade-in-0 duration-200">
              <IssueCard l={line} on badge={badges[line.key] ?? null} clipIdx={clipIdx} tap={tap} />
            </div>
          ) : null}
        </div>
      ) : (
      /* min-h: never squeezed out by the fixed part above; if the screen is too short the whole panel scrolls. */
      <div ref={listRef} className="-mx-1 flex min-h-44 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-1 pb-1">
        {groups.map((group) => (
          <section key={group.rating} className="flex flex-col gap-2" aria-labelledby={`sec-${group.rating}`}>
            {filter === "all" ? (
              <h2 id={`sec-${group.rating}`} className="flex items-center gap-2 text-sm font-semibold">
                {RATING_LABEL[group.rating]}
                <span className="font-normal text-muted-foreground">{group.lines.length}</span>
              </h2>
            ) : null}
            <ul className="flex flex-col gap-2">
              {group.lines.map((l) => {
                const on = l.key === line?.key;
                const badge = badges[l.key] ?? null;
                return (
                  <li key={l.key} data-issue-key={l.key}>
                    <IssueCard l={l} on={on} badge={badge} clipIdx={clipIdx} tap={tap} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      )}
    </div>
  );
}

/** One issue: name, change badge, rating, note, and (when it's the playing one) buttons for its other clips. */
function IssueCard({
  l,
  on,
  badge,
  clipIdx,
  tap,
}: {
  l: ShareLine;
  on: boolean;
  badge: LineChangeBadge | null;
  clipIdx: number;
  tap: (e: React.MouseEvent, key: string, clip: number) => void;
}) {
  return (
    <div className={cn("rounded-lg border transition-colors", on ? TONE_ON[RATING_TONE[l.rating]] : "hover:bg-accent/40")}>
      <button
        type="button"
        aria-current={on ? "true" : undefined}
        onClick={(e) => tap(e, l.key, 0)}
        className="flex w-full flex-col gap-1.5 p-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mr-auto text-[15px] font-semibold">{l.component_name}</span>
          {badge === "new" ? <Badge variant="blue">New</Badge> : badge === "updated" ? <Badge variant="blue">Updated</Badge> : null}
          <RatingBadge rating={l.rating} />
        </span>
        <span className={cn("text-sm leading-relaxed whitespace-pre-line", on ? "text-foreground" : "line-clamp-2 text-muted-foreground")}>
          {l.note}
        </span>
      </button>
      {on && l.clips.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
          <span className="text-xs text-muted-foreground">Clips</span>
          {l.clips.map((c, i) => (
            <Button
              key={c.clip_url}
              size="sm"
              variant="outline"
              className={cn(i === clipIdx && TONE_ON[RATING_TONE[l.rating]])}
              aria-label={`Play clip ${i + 1} of ${l.component_name}`}
              aria-current={i === clipIdx}
              onClick={(e) => tap(e, l.key, i)}
            >
              {i + 1}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Laptop: fills the space it's given; the player takes what's left, the issues scroll on their own. */
export function ReportViewer({ lines, badges }: { lines: ShareLine[]; badges: Record<string, LineChangeBadge> }) {
  const r = useReportPlayer(lines);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(340px,400px)] gap-5">
      <div className="flex min-h-0 flex-col gap-3">
        <PlayerPane r={r} fill />
      </div>
      <div className="flex min-h-0 flex-col rounded-xl p-4 ring-1 ring-foreground/10">
        <IssuePanel r={r} badges={badges} />
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("shrink-0 rounded-full transition-opacity", active ? "opacity-100" : "opacity-45 hover:opacity-80")}
    >
      {children}
    </button>
  );
}
