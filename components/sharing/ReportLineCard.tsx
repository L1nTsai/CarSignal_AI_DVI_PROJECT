"use client";
/**
 * One line of the customer report: name, rating, change badge, note, and the
 * line's media. The main photo plays its clip inline on tap; "+N more clips"
 * reveals the rest, and picking one plays it in the same spot.
 *
 * Customer-facing: only renders ShareLine fields (no quotes, AI data or
 * edit controls exist in that type).
 */
import { useState } from "react";
import { Badge, Card, RatingBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { LineChangeBadge } from "@/lib/sharing/diff";
import type { ShareLine } from "@/lib/types/api";

export function ReportLineCard({ line, badge }: { line: ShareLine; badge: LineChangeBadge }) {
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const clip = line.clips[selected] ?? line.clips[0];
  const more = line.clips.length - 1;

  return (
    <Card className="overflow-hidden">
      {clip ? (
        playing ? (
          <video
            key={clip.clip_url}
            src={clip.clip_url}
            poster={clip.thumbnail_url}
            controls
            autoPlay
            playsInline
            className="block max-h-[60vh] w-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group relative block w-full"
            aria-label={`Play video of ${line.component_name}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- token-scoped proxy URL, no optimizer */}
            <img src={clip.thumbnail_url} alt={line.component_name} className="media block max-h-[60vh] w-full" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-white group-hover:bg-black/75">
                <PlayIcon />
              </span>
            </span>
          </button>
        )
      ) : null}

      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-base font-semibold">{line.component_name}</h3>
          {badge === "new" ? <Badge tone="blue">New</Badge> : badge === "updated" ? <Badge tone="blue">Updated</Badge> : null}
          <RatingBadge rating={line.rating} />
        </div>
        <p className="text-[15px] leading-relaxed whitespace-pre-line">{line.note}</p>

        {more > 0 ? (
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              className="self-start text-sm font-medium text-link hover:underline"
            >
              {showMore ? "Hide clips" : `+${more} more clip${more === 1 ? "" : "s"}`}
            </button>
            {showMore ? (
              <ul className="grid grid-cols-3 gap-2">
                {line.clips.map((c, i) => (
                  <li key={c.clip_url}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(i);
                        setPlaying(true);
                      }}
                      aria-label={`Play clip ${i + 1} of ${line.component_name}`}
                      aria-current={i === selected}
                      className={cn(
                        "relative block w-full overflow-hidden rounded-md border-2",
                        i === selected ? "border-foreground" : "border-transparent",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- token-scoped proxy URL */}
                      <img src={c.thumbnail_url} alt="" className="media block aspect-square w-full" />
                      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs text-white">
                        {i + 1}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ml-1 size-6" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}
