"use client";
/** Three labelled rating buttons. The selected one shows color, a check and its label (never color alone). */
import { cn } from "@/lib/cn";
import { RATING_LABEL } from "@/lib/ratings";
import type { LineRating } from "@/lib/types/db";

const ORDER: LineRating[] = ["good", "monitor", "needs_attention"];

const SELECTED: Record<LineRating, string> = {
  good: "bg-green-bg text-green-fg border-green-fg",
  monitor: "bg-amber-bg text-amber-fg border-amber-fg",
  needs_attention: "bg-red-bg text-red-fg border-red-fg",
};

export function RatingPicker({
  value,
  onChange,
  disabled,
  label = "Rating",
}: {
  value: LineRating | null;
  onChange: (r: LineRating) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-2">
      {ORDER.map((r) => {
        const on = value === r;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !on && onChange(r)}
            className={cn(
              "flex min-h-12 items-center justify-center gap-1.5 rounded-md border px-2 text-sm font-medium leading-tight",
              "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              on ? cn(SELECTED[r], "border-2") : "border-border bg-background text-foreground hover:bg-surface-hover",
            )}
          >
            {on ? <span aria-hidden>✓</span> : null}
            <span className="text-center">{RATING_LABEL[r]}</span>
          </button>
        );
      })}
    </div>
  );
}
