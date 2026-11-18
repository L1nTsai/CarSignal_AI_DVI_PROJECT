"use client";
/**
 * Top-down car. vertical: front at the top, driver's side (left) on the left.
 * horizontal: the same drawing turned a quarter clockwise, so the front points
 * right and the driver's side is on top.
 * One shape per zone (lib/carZones.ts). Flat, theme-token colors only.
 *
 * - report: zones with an issue are tinted by rating and are buttons
 *   (aria-label carries the rating as text); `current` gets a thick outline.
 * - pick: every zone is a button; `current` is the selected one.
 */
import { CAR_ZONE_LABEL, type CarZone } from "@/lib/carZones";
import { cn } from "@/lib/cn";
import { RATING_LABEL } from "@/lib/ratings";
import type { LineRating } from "@/lib/types/db";

type Shape = { d: string } | { x: number; y: number; w: number; h: number; r?: number };

/** Drawn upright in a 200 × 420 box. */
const SHAPES: Record<Exclude<CarZone, "underbody">, Shape> = {
  front_bumper: { d: "M56 30 Q100 10 144 30 L144 40 L56 40 Z" },
  headlight_l: { x: 50, y: 42, w: 24, h: 10, r: 3 },
  headlight_r: { x: 126, y: 42, w: 24, h: 10, r: 3 },
  hood_engine: { x: 50, y: 54, w: 100, h: 74, r: 6 },
  wheel_lf: { x: 24, y: 70, w: 18, h: 50, r: 5 },
  wheel_rf: { x: 158, y: 70, w: 18, h: 50, r: 5 },
  mirror_l: { d: "M42 148 L26 142 L26 156 L42 158 Z" },
  mirror_r: { d: "M158 148 L174 142 L174 156 L158 158 Z" },
  windshield: { d: "M56 132 L144 132 L136 160 L64 160 Z" },
  door_lf: { x: 44, y: 164, w: 14, h: 60, r: 3 },
  door_rf: { x: 142, y: 164, w: 14, h: 60, r: 3 },
  cabin: { x: 62, y: 164, w: 76, h: 126, r: 6 },
  door_lr: { x: 44, y: 228, w: 14, h: 60, r: 3 },
  door_rr: { x: 142, y: 228, w: 14, h: 60, r: 3 },
  wheel_lr: { x: 24, y: 296, w: 18, h: 50, r: 5 },
  wheel_rr: { x: 158, y: 296, w: 18, h: 50, r: 5 },
  rear_window: { d: "M64 294 L136 294 L142 318 L58 318 Z" },
  trunk: { x: 50, y: 322, w: 100, h: 48, r: 6 },
  taillight_l: { x: 50, y: 372, w: 24, h: 10, r: 3 },
  taillight_r: { x: 126, y: 372, w: 24, h: 10, r: 3 },
  rear_bumper: { d: "M56 384 L144 384 L144 392 Q100 412 56 392 Z" },
};

const FILL: Record<LineRating, string> = {
  needs_attention: "fill-red-bg",
  monitor: "fill-amber-bg",
  good: "fill-green-bg",
};
const STROKE: Record<LineRating, string> = {
  needs_attention: "stroke-red-fg",
  monitor: "stroke-amber-fg",
  good: "stroke-green-fg",
};

export interface CarDiagramProps {
  mode: "report" | "pick";
  /** report: the worst rating per zone with an issue. */
  ratings?: ReadonlyMap<CarZone, LineRating>;
  /** report: the playing issue's zone. pick: the selected zone. */
  current?: CarZone | null;
  onSelect?: (zone: CarZone) => void;
  /** Extra text for a zone's accessible name (e.g. the issue names). */
  describe?: (zone: CarZone) => string | undefined;
  disabled?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
}

export function CarDiagram({
  mode,
  ratings,
  current,
  onSelect,
  describe,
  disabled,
  orientation = "vertical",
  className,
}: CarDiagramProps) {
  const horizontal = orientation === "horizontal";
  const zone = (z: CarZone, shape: React.ReactNode) => {
    const rating = ratings?.get(z);
    const active = mode === "pick" || !!rating;
    const isCurrent = current === z;
    const label =
      CAR_ZONE_LABEL[z] +
      (rating ? `: ${RATING_LABEL[rating]}` : "") +
      (describe?.(z) ? ` (${describe(z)})` : "");
    const interactive = active && !!onSelect && !disabled;
    return (
      <g
        key={z}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? label : undefined}
        aria-pressed={interactive && mode === "pick" ? isCurrent : undefined}
        onClick={interactive ? () => onSelect(z) : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(z);
                }
              }
            : undefined
        }
        className={cn(
          "outline-none [&>*]:transition-[stroke-width,fill]",
          interactive && "cursor-pointer focus-visible:[&>*]:stroke-[3.5] hover:[&>*]:stroke-[2.5]",
          // Fill: the rating's tint; stroke: the rating's color, or the foreground for
          // the playing zone (the legend's "Playing now").
          rating
            ? cn(FILL[rating], isCurrent ? "stroke-foreground" : STROKE[rating])
            : mode === "pick" && isCurrent
              ? "fill-primary/25 stroke-primary"
              : "fill-muted stroke-border",
          isCurrent ? "[&>*]:stroke-[3.5]" : "[&>*]:stroke-[1.25]",
        )}
      >
        <title>{label}</title>
        {shape}
      </g>
    );
  };

  const underRating = ratings?.get("underbody");
  const labelClass = "fill-muted-foreground text-[11px]";
  return (
    <svg
      // Room around the 200 × 420 drawing (turned to 420 × 200 when horizontal) for the labels.
      viewBox={horizontal ? "-24 -18 468 236" : "-6 -4 212 428"}
      className={cn("h-auto w-full select-none", className)}
      role="group"
      aria-label={mode === "pick" ? "Choose where on the car" : "Where the issues are on the car"}
    >
      {/* Quarter turn clockwise: (x, y) -> (420 - y, x). Front ends up on the right, driver's side on top. */}
      <g transform={horizontal ? "translate(420 0) rotate(90)" : undefined}>
        {/* Underneath: a dashed outline around the whole car. */}
        {zone(
          "underbody",
          <rect
            x={8}
            y={8}
            width={184}
            height={404}
            rx={28}
            strokeDasharray="6 5"
            className={cn(!underRating && !(mode === "pick" && current === "underbody") && "fill-transparent")}
          />,
        )}
        {/* Body outline (decorative). */}
        <rect x={42} y={24} width={116} height={374} rx={42} className="pointer-events-none fill-card stroke-foreground/30" strokeWidth={1.5} />
        {(Object.keys(SHAPES) as (keyof typeof SHAPES)[]).map((z) => {
          const sh = SHAPES[z];
          return zone(z, "d" in sh ? <path d={sh.d} /> : <rect x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={sh.r ?? 0} />);
        })}
      </g>
      {horizontal ? (
        <g aria-hidden>
          <text x={210} y={-6} textAnchor="middle" className={labelClass}>
            Driver side
          </text>
          <text x={434} y={100} textAnchor="middle" transform="rotate(90 434 100)" className={labelClass}>
            Front
          </text>
          <text x={-14} y={100} textAnchor="middle" transform="rotate(-90 -14 100)" className={labelClass}>
            Rear
          </text>
        </g>
      ) : (
        <g aria-hidden>
          <text x={100} y={2} textAnchor="middle" dominantBaseline="hanging" className={labelClass}>
            Front
          </text>
          <text x={100} y={420} textAnchor="middle" className={labelClass}>
            Rear
          </text>
          <text x={14} y={232} textAnchor="middle" transform="rotate(-90 14 232)" className="fill-muted-foreground text-[10px]">
            Driver side
          </text>
        </g>
      )}
    </svg>
  );
}
