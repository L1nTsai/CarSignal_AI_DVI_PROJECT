"use client";
/**
 * Laptop studio: a slim row under the transport for the selected saved clip.
 * "Clip 2 · 0:12–0:20", its cut status when not ready (Retry cut if it failed), a Drawings (n) popover
 * (jump to / delete each drawing) and Delete clip. Replaces the Clip and
 * Drawings sections the Details panel used to have.
 */
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMs } from "@/lib/editor/clipRange";
import type { ClipDetail, LineDetail } from "@/lib/types/api";
import { ClipStatus } from "@/components/shared/editor/ClipStatus";
import { DeleteClip, DrawingsSection, RetryCut } from "./SidePanel";
import type { Player } from "./usePlayer";
import { clipNumber } from "./types";

/** A delete confirm opened from inside the popover lives in a dialog outside it; don't close the popover for that. */
function insideDialog(e: { target: EventTarget | null; preventDefault: () => void }) {
  if (e.target instanceof Element && e.target.closest('[role="alertdialog"],[role="dialog"]')) e.preventDefault();
}

export function ClipBar({
  line,
  clip,
  player,
  onSelectClip,
}: {
  line: LineDetail;
  clip: ClipDetail;
  player: Player;
  onSelectClip: (lineId: string, clipId: string | null) => void;
}) {
  const n = clipNumber(line, clip.id);
  const drawings = clip.annotations.length;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-card px-3 py-1 text-sm">
      <span className="font-medium">Clip {n}</span>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {formatMs(clip.start_ms)}–{formatMs(clip.end_ms)}
      </span>
      {clip.status !== "ready" ? <ClipStatus clip={clip} /> : null}
      {clip.status === "failed" ? <RetryCut key={clip.id} clip={clip} /> : null}

      <div className="ml-auto flex items-center gap-1">
        {drawings > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                Drawings ({drawings})
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72" onInteractOutside={insideDialog} onFocusOutside={insideDialog}>
              <DrawingsSection clip={clip} player={player} hideWhenEmpty />
            </PopoverContent>
          </Popover>
        ) : null}
        <DeleteClip key={clip.id} line={line} clip={clip} n={n} onDeleted={(next) => onSelectClip(line.id, next)} />
      </div>
    </div>
  );
}
