/**
 * Manual clip-range rules for the editor (plan §4, §10). Pure; safe anywhere.
 * The DB enforces start >= 0, end > start and length <= 60 s; this mirrors
 * those checks so the UI can explain them before saving.
 */

/** Manual clips can be up to 60 s (clips table check). */
export const MAX_MANUAL_CLIP_MS = 60_000;
/** Nudge step for Set start / Set end. */
export const NUDGE_MS = 500;

/** Returns a message for the tech, or null when the range is valid. */
export function rangeError(startMs: number, endMs: number, durationMs: number | null): string | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "Set a start and an end.";
  if (startMs < 0) return "The start can't be before the beginning of the video.";
  if (durationMs !== null && endMs > durationMs) return "The end can't be after the end of the video.";
  if (endMs <= startMs) return "The end must be after the start.";
  if (endMs - startMs > MAX_MANUAL_CLIP_MS) return "A clip can be at most 60 seconds long.";
  return null;
}

/** Pause points strictly inside the range (a clip that crosses one shows a jump). */
export function pausePointsInside(startMs: number, endMs: number, pausePointsMs: number[]): number[] {
  return pausePointsMs.filter((p) => p > startMs && p < endMs);
}

export function clampMs(ms: number, durationMs: number | null): number {
  const hi = durationMs ?? Number.POSITIVE_INFINITY;
  return Math.round(Math.min(hi, Math.max(0, ms)));
}

/** "1:04.5" (minutes:seconds.tenths). */
export function formatMs(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const t = tenths % 10;
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}
