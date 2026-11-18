"use client";
/** Amber bar shown while drawing: colors, undo/clear, how long it shows, Cancel / Save. */
import { Check, Minus, Plus, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ANNOTATION_COLOR_KEYS, ANNOTATION_COLORS, MAX_WINDOW_MS, MIN_WINDOW_MS } from "@/lib/annotations";
import type { DrawSession } from "./useDrawSession";

export function DrawBar({ draw, compact = false }: { draw: DrawSession; compact?: boolean }) {
  const s = draw.state;
  if (!s) return null;
  const empty = s.strokes.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t bg-amber-bg px-3 py-1.5 text-sm text-amber-fg">
      <span className="font-medium">Drawing</span>

      <div role="radiogroup" aria-label="Pen color" className="flex items-center gap-1">
        {ANNOTATION_COLOR_KEYS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={s.color === c}
            aria-label={ANNOTATION_COLORS[c].label}
            title={ANNOTATION_COLORS[c].label}
            onClick={() => draw.setColor(c)}
            className={cn(
              "flex items-center justify-center rounded-full ring-offset-2 ring-offset-amber-bg transition-shadow",
              compact ? "size-8" : "size-6",
              s.color === c ? "ring-2 ring-amber-fg" : "ring-1 ring-foreground/20",
            )}
          >
            <span className="size-full rounded-full border border-black/30" style={{ background: ANNOTATION_COLORS[c].css }} />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size={compact ? "icon" : "icon-sm"} aria-label="Undo the last stroke" onClick={draw.undo} disabled={empty}>
          <Undo2 />
        </Button>
        <Button variant="ghost" size="sm" onClick={draw.clear} disabled={empty}>
          Clear
        </Button>
      </div>

      <div className="flex items-center gap-1" aria-label="How long the drawing shows">
        <span className="text-xs">Shows for</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Shorter"
          onClick={() => draw.setWindow(s.windowMs - 1000)}
          disabled={s.windowMs <= MIN_WINDOW_MS}
        >
          <Minus />
        </Button>
        <span className="w-8 text-center font-mono text-xs tabular-nums">{s.windowMs / 1000} s</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Longer"
          onClick={() => draw.setWindow(s.windowMs + 1000)}
          disabled={s.windowMs >= MAX_WINDOW_MS}
        >
          <Plus />
        </Button>
      </div>

      {draw.error ? <span className="text-xs text-destructive">{draw.error}</span> : null}

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={draw.cancel} disabled={draw.saving}>
          <X />
          Cancel
        </Button>
        <Button size="sm" onClick={draw.save} disabled={draw.saving || empty}>
          <Check />
          {draw.saving ? "Saving…" : "Save drawing"}
        </Button>
      </div>
    </div>
  );
}
