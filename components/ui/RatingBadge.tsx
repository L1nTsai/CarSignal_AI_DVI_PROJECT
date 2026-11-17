import { RATING_LABEL } from "@/lib/ratings";
import type { LineRating } from "@/lib/types/db";
import { Badge, type BadgeTone } from "./Badge";

export const RATING_TONE: Record<LineRating, BadgeTone> = {
  needs_attention: "red",
  monitor: "amber",
  good: "green",
};

/** Rating shown as text + color (never color alone). */
export function RatingBadge({ rating, size = "sm" }: { rating: LineRating; size?: "sm" | "md" }) {
  return (
    <Badge tone={RATING_TONE[rating]} size={size}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {RATING_LABEL[rating]}
    </Badge>
  );
}
