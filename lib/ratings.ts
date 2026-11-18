/** Rating + status labels and ordering. Pure; safe anywhere. */
import type { InspectionStatus, LineRating, ProcessingStep } from "./types/db";

export const RATING_LABEL: Record<LineRating, string> = {
  needs_attention: "Needs attention",
  monitor: "Monitor",
  good: "Good",
};

/** Customer page section order. */
export const RATING_ORDER: readonly LineRating[] = ["needs_attention", "monitor", "good"];

/** Group lines by rating in RATING_ORDER, keeping input order within each group. */
export function groupByRating<T extends { rating: LineRating }>(lines: T[]): { rating: LineRating; lines: T[] }[] {
  return RATING_ORDER.map((rating) => ({ rating, lines: lines.filter((l) => l.rating === rating) })).filter(
    (g) => g.lines.length > 0,
  );
}

/** e.g. "2 need attention · 1 to monitor · 5 good" (zero counts omitted). */
export function ratingSummary(lines: { rating: LineRating }[]): string {
  const n = (r: LineRating) => lines.filter((l) => l.rating === r).length;
  const parts: string[] = [];
  const na = n("needs_attention");
  const mo = n("monitor");
  const go = n("good");
  if (na) parts.push(`${na} need${na === 1 ? "s" : ""} attention`);
  if (mo) parts.push(`${mo} to monitor`);
  if (go) parts.push(`${go} good`);
  return parts.join(" · ");
}

export const STATUS_LABEL: Record<InspectionStatus, string> = {
  recording: "Draft",
  processing: "Processing",
  ready_for_review: "Ready for review",
  sent: "Sent",
  failed: "Failed",
};

export const PROCESSING_STEP_LABEL: Record<ProcessingStep, string> = {
  converting: "Converting",
  analyzing: "AI reviewing",
  cutting: "Cutting clips",
};
