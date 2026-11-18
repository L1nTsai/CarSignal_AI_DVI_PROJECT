"use client";
/**
 * "Where on your car": the top-down car, lying sideways (front to the right),
 * at the top of the issues panel. Every zone with an issue is tinted by its
 * worst rating, the playing issue is outlined, and tapping a zone plays it.
 * A one-line legend (text + color) and the issues with no spot sit underneath.
 *
 * Customer-facing: only ShareLine fields reach this component.
 */
import { RATING_TONE } from "@/components/app";
import { CarDiagram } from "@/components/shared/CarDiagram";
import { zoneSummary, type CarZone } from "@/lib/carZones";
import { cn } from "@/lib/cn";
import { groupByRating, RATING_LABEL, RATING_ORDER } from "@/lib/ratings";
import type { ReportPlayer } from "./ReportViewer";

const SWATCH = { red: "bg-red-bg border-red-fg", amber: "bg-amber-bg border-amber-fg", green: "bg-green-bg border-green-fg", blue: "", gray: "" };

/** `compact` (phone): a small diagram, a one-line heading and a tighter legend, so the issue cards keep their room. */
export function CarMap({ r, className, compact = false }: { r: ReportPlayer; className?: string; compact?: boolean }) {
  // Display order (worst first), so tapping a zone plays its worst issue.
  const ordered = groupByRating(r.lines).flatMap((g) => g.lines);
  const { zones, unplaced } = zoneSummary(ordered);
  if (zones.size === 0) return null;

  const ratings = new Map([...zones].map(([z, e]) => [z, e.rating] as const));
  const play = (zone: CarZone) => {
    const first = zones.get(zone)?.lines[0];
    if (!first) return;
    if (r.filter !== "all" && r.filter !== first.rating) r.setFilter("all");
    r.go(first.key, 0);
  };
  const used = RATING_ORDER.filter((rt) => [...zones.values()].some((e) => e.rating === rt));

  return (
    <section aria-labelledby="car-map-title" className={cn("flex flex-col", compact ? "gap-1" : "gap-2", className)}>
      <div className={cn("flex items-baseline gap-x-3", compact ? "min-w-0" : "flex-wrap justify-between gap-y-1")}>
        <h2 id="car-map-title" className={cn("font-semibold", compact ? "shrink-0 text-xs" : "text-sm")}>
          Where on your car
        </h2>
        <p className={cn("text-xs text-muted-foreground", compact && "min-w-0 truncate")}>
          {compact ? "Tap a part to play it." : "Tap a highlighted part to see its video."}
        </p>
      </div>
      <CarDiagram
        mode="report"
        orientation="horizontal"
        ratings={ratings}
        current={r.line?.car_zone ?? null}
        onSelect={play}
        describe={(z) => zones.get(z)?.lines.map((l) => l.component_name).join(", ")}
        className={cn("mx-auto", compact ? "max-w-[13rem]" : "max-w-md")}
      />
      <ul
        className={cn(
          "flex flex-wrap items-center justify-center",
          compact ? "gap-x-3 gap-y-0.5 text-[11px]" : "gap-x-4 gap-y-1 text-xs",
        )}
        aria-label="Legend"
      >
        {used.map((rt) => (
          <li key={rt} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-3 shrink-0 rounded-sm border-2", SWATCH[RATING_TONE[rt]])} />
            {RATING_LABEL[rt]}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 shrink-0 rounded-sm border-[3px] border-foreground" />
          Playing now
        </li>
      </ul>
      {unplaced.length > 0 ? (
        <p className={cn("text-center text-xs text-muted-foreground", compact && "truncate text-[11px]")}>
          Not shown on the car: {unplaced.map((l) => l.component_name).join(", ")}
        </p>
      ) : null}
    </section>
  );
}
