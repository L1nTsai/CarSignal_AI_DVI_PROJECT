/**
 * Candidate-frame timing and thumbnail rules for cut_clip (plan §7). Pure.
 */
import type { ClipRange } from "./ranges";

/** Offsets around best_frame for AI clips. */
export const AI_FRAME_OFFSETS_MS = [-1000, -500, 0, 500, 1000] as const;
export const EVEN_FRAME_COUNT = 5;
/** Keep frames this far before the clip end so a frame always exists there. */
export const END_GUARD_MS = 100;

/**
 * Times (ms, stitched timeline) to grab candidate frames at, all inside the clip.
 * - AI clip with best_frame inside the clip: best_frame -1000/-500/0/+500/+1000,
 *   clamped into the clip, de-duplicated.
 * - Tech clip (no best_frame), or best_frame no longer inside a re-ranged clip:
 *   5 evenly spaced (centres of 5 equal slices).
 */
export function candidateFrameTimes(clip: ClipRange, bestFrameMs: number | null): number[] {
  const lo = clip.start_ms;
  const hi = Math.max(lo, clip.end_ms - END_GUARD_MS);
  const inside = bestFrameMs !== null && bestFrameMs >= clip.start_ms && bestFrameMs <= clip.end_ms;
  const raw = inside
    ? AI_FRAME_OFFSETS_MS.map((o) => bestFrameMs + o)
    : Array.from({ length: EVEN_FRAME_COUNT }, (_, i) =>
        lo + ((i + 0.5) * (clip.end_ms - lo)) / EVEN_FRAME_COUNT,
      );
  const out = raw.map((t) => Math.round(Math.min(hi, Math.max(lo, t))));
  return [...new Set(out)].sort((a, b) => a - b);
}

/** cut_clip step 5: replace the thumbnail when there is none or it fell outside the clip. */
export function needsNewThumbnail(clip: ClipRange, currentThumbMs: number | null): boolean {
  return currentThumbMs === null || currentThumbMs < clip.start_ms || currentThumbMs > clip.end_ms;
}

/** Index of the highest score (first wins ties); -1 for an empty list. */
export function sharpestIndex(scores: readonly number[]): number {
  let best = -1;
  for (let i = 0; i < scores.length; i++) if (best < 0 || scores[i] > scores[best]) best = i;
  return best;
}
