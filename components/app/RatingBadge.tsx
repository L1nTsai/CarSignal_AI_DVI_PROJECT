import { Badge } from "@/components/ui/badge";
import { RATING_LABEL } from "@/lib/ratings";
import type { LineRating } from "@/lib/types/db";

export type Tone = "red" | "amber" | "green" | "blue" | "gray";

export const RATING_TONE: Record<LineRating, Tone> = {
  needs_attention: "red",
  monitor: "amber",
  good: "green",
};

/** Rating shown as text + color (never color alone). */
export function RatingBadge({ rating, size = "default" }: { rating: LineRating; size?: "default" | "lg" }) {
  return (
    <Badge variant={RATING_TONE[rating]} size={size}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {RATING_LABEL[rating]}
    </Badge>
  );
}
