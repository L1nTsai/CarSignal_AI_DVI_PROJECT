/**
 * Clip ranges for AI mentions (plan §9). Pure; safe anywhere. Unit-tested in
 * ranges.test.ts.
 *
 *   for each mention m:
 *     range = [visible_start - PAD_BEFORE, visible_end + PAD_AFTER]
 *     clamp to the recorded piece containing best_frame (never cross a pause point)
 *     clamp to [0, duration]
 *   sort by visible_start; for adjacent mentions of DIFFERENT lines whose padded
 *   ranges overlap, split at midpoint(a.visible_end, b.visible_start), never
 *   cutting into a visible span (if the visible spans overlap, the overlap stays)
 *   if longer than MAX: a MAX window centred on best_frame, kept inside the range
 *
 * All values are integer ms on the stitched timeline.
 */

/** The DB rejects clips longer than this (clips.end_ms - start_ms <= 60000). */
export const DB_MAX_CLIP_MS = 60_000;

export interface ClipRangeSettings {
  padBeforeMs: number;
  padAfterMs: number;
  maxMs: number;
}

export const DEFAULT_CLIP_RANGE_SETTINGS: ClipRangeSettings = {
  padBeforeMs: 3000,
  padAfterMs: 3000,
  maxMs: 20_000,
};

export interface Timeline {
  duration_ms: number;
  /** Start of each recorded piece on the stitched timeline. First is 0. */
  segment_starts_ms: number[];
}

export interface RangeMention {
  /** Which line the mention belongs to (any stable key; only equality matters). */
  line: string | number;
  visible_start_ms: number;
  visible_end_ms: number;
  best_frame_ms: number;
}

export interface ClipRange {
  start_ms: number;
  end_ms: number;
}

/**
 * [start, end) of the recorded piece containing `t`. A time exactly on a pause
 * point belongs to the piece that starts there.
 */
export function pieceAt(t: number, tl: Timeline): ClipRange {
  const starts = normalizedStarts(tl);
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= t) i++;
  return { start_ms: starts[i], end_ms: i + 1 < starts.length ? starts[i + 1] : tl.duration_ms };
}

function normalizedStarts(tl: Timeline): number[] {
  const s = [...new Set([0, ...tl.segment_starts_ms])]
    .filter((x) => x >= 0 && x < tl.duration_ms)
    .sort((a, b) => a - b);
  return s.length ? s : [0];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

interface Work {
  idx: number;
  line: string | number;
  vs: number; // visible span, clamped into the range
  ve: number;
  bf: number;
  start: number;
  end: number;
  piece: ClipRange;
}

/** One range per mention, returned in the same order as `mentions`. */
export function computeClipRanges(
  mentions: readonly RangeMention[],
  tl: Timeline,
  settings: ClipRangeSettings = DEFAULT_CLIP_RANGE_SETTINGS,
): ClipRange[] {
  if (!(tl.duration_ms > 0)) throw new Error("duration_ms must be > 0");
  const max = clamp(Math.round(settings.maxMs), 1, DB_MAX_CLIP_MS);
  const padB = Math.max(0, settings.padBeforeMs);
  const padA = Math.max(0, settings.padAfterMs);

  // 1. Pad, clamp to the piece holding best_frame, clamp to the video.
  const work: Work[] = mentions.map((m, idx) => {
    const bf = clamp(Math.round(m.best_frame_ms), 0, tl.duration_ms);
    const piece = pieceAt(bf, tl);
    const lo = Math.max(0, piece.start_ms);
    const hi = Math.min(tl.duration_ms, piece.end_ms);
    const start = clamp(Math.round(m.visible_start_ms - padB), lo, hi);
    const end = clamp(Math.round(m.visible_end_ms + padA), lo, hi);
    return {
      idx,
      line: m.line,
      vs: clamp(Math.round(m.visible_start_ms), start, end),
      ve: clamp(Math.round(m.visible_end_ms), start, end),
      bf,
      start,
      end,
      piece: { start_ms: lo, end_ms: hi },
    };
  });

  // 2. Split overlaps between neighbouring mentions of different lines.
  const sorted = [...work].sort((a, b) => a.vs - b.vs || a.ve - b.ve || a.idx - b.idx);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.line === b.line || a.end <= b.start) continue;
    const cut = Math.round((a.ve + b.vs) / 2);
    a.end = Math.max(a.ve, Math.min(a.end, cut));
    b.start = Math.min(b.vs, Math.max(b.start, cut));
  }

  // 3. Cap the length around best_frame; guarantee end > start.
  return work.map((w) => {
    let { start, end } = w;
    if (end - start > max) {
      start = clamp(Math.round(w.bf - max / 2), start, end - max);
      end = start + max;
    }
    if (end <= start) {
      // Only possible with a degenerate (near-zero) piece. Grow inside the piece.
      end = Math.min(w.piece.end_ms, start + 1000);
      start = Math.max(w.piece.start_ms, end - 1000);
      if (end <= start) throw new Error(`cannot build a clip range for mention ${w.idx}`);
    }
    return { start_ms: start, end_ms: end };
  });
}
