/**
 * Clip annotations: freehand drawings the tech puts on a clip, shown to the
 * customer over the playing video. Pure (zod only), so it's safe on the client.
 *
 * - Stored on `clips.annotations`. Times are on the STITCHED timeline, like the
 *   clip's own range, so a range change doesn't move a drawing in time.
 * - x and y are 0..1 over the full video frame. Stitched video and clips share
 *   one frame size (worker/lib/video.ts pads every piece), so the same
 *   coordinates fit both.
 * - The customer gets clip-time copies with no ids (`toClipTime`).
 */
import { z } from "zod";

export const ANNOTATION_COLOR_KEYS = ["red", "yellow", "white"] as const;
export type AnnotationColor = (typeof ANNOTATION_COLOR_KEYS)[number];

/**
 * Drawn marks sit on top of video, so they use fixed colors rather than theme
 * tokens: they must look the same in light and dark mode.
 */
export const ANNOTATION_COLORS: Record<AnnotationColor, { label: string; css: string }> = {
  red: { label: "Red", css: "#ff3b30" },
  yellow: { label: "Yellow", css: "#ffd60a" },
  white: { label: "White", css: "#ffffff" },
};

/** How long a new drawing stays up. */
export const DEFAULT_WINDOW_MS = 3000;
export const MIN_WINDOW_MS = 1000;
export const MAX_WINDOW_MS = 10_000;

export const MAX_ANNOTATIONS_PER_CLIP = 20;
export const MAX_STROKES_PER_ANNOTATION = 30;
export const MAX_POINTS_PER_CLIP = 20_000;

/** Stroke width as a fraction of the frame's height. */
export const STROKE_WIDTH = 0.012;

export type Point = [x: number, y: number];

export interface Stroke {
  color: AnnotationColor;
  points: Point[];
}

/** One drawing, as stored on the clip (stitched timeline). */
export interface Annotation {
  id: string;
  start_ms: number;
  end_ms: number;
  strokes: Stroke[];
}

/** What the customer gets: clip time, no ids. */
export interface ClipAnnotation {
  start_ms: number;
  end_ms: number;
  strokes: Stroke[];
}

const unit = z.number().min(0).max(1);
const ms = z.number().int().nonnegative();

export const strokeSchema = z
  .object({
    color: z.enum(ANNOTATION_COLOR_KEYS),
    points: z.array(z.tuple([unit, unit])).min(1),
  })
  .strict();

export const annotationSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
    start_ms: ms,
    end_ms: ms,
    strokes: z.array(strokeSchema).min(1, "A drawing needs at least one stroke").max(MAX_STROKES_PER_ANNOTATION),
  })
  .strict()
  .refine((a) => a.end_ms > a.start_ms, { message: "A drawing must end after it starts" })
  .refine((a) => a.end_ms - a.start_ms <= MAX_WINDOW_MS, { message: "A drawing can show for at most 10 seconds" });

export const annotationsSchema = z
  .array(annotationSchema)
  .max(MAX_ANNOTATIONS_PER_CLIP, `A clip can have at most ${MAX_ANNOTATIONS_PER_CLIP} drawings`)
  .refine((list) => new Set(list.map((a) => a.id)).size === list.length, { message: "Duplicate drawing ids" })
  .refine((list) => totalPoints(list) <= MAX_POINTS_PER_CLIP, { message: "These drawings are too detailed to save" });

export function totalPoints(list: readonly { strokes: readonly Stroke[] }[]): number {
  return list.reduce((n, a) => n + a.strokes.reduce((m, s) => m + s.points.length, 0), 0);
}

/** A short random id (no crypto.randomUUID: it needs a secure context, and the phone may not have one). */
export function newAnnotationId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The window for a drawing made at `nowMs`: from now for `windowMs`, kept inside the clip. */
export function newAnnotationWindow(
  nowMs: number,
  clip: { start_ms: number; end_ms: number },
  windowMs: number = DEFAULT_WINDOW_MS,
): { start_ms: number; end_ms: number } {
  const len = Math.min(Math.max(windowMs, MIN_WINDOW_MS), MAX_WINDOW_MS, clip.end_ms - clip.start_ms);
  let start = Math.round(Math.min(Math.max(nowMs, clip.start_ms), clip.end_ms));
  if (start + len > clip.end_ms) start = Math.max(clip.start_ms, clip.end_ms - len);
  return { start_ms: start, end_ms: Math.min(clip.end_ms, start + len) };
}

/** Does the drawing show at all within the clip's range? */
export function insideClip(a: { start_ms: number; end_ms: number }, clip: { start_ms: number; end_ms: number }): boolean {
  return a.end_ms > clip.start_ms && a.start_ms < clip.end_ms;
}

/**
 * Convert stitched-timeline drawings to the customer's clip time: keep those
 * that overlap the clip, shift so the clip starts at 0, clamp to its length,
 * and drop the ids. Order is by start time.
 */
export function toClipTime(
  annotations: readonly Annotation[] | null | undefined,
  clipStartMs: number | null,
  clipEndMs: number | null,
): ClipAnnotation[] {
  if (!annotations?.length || clipStartMs === null || clipEndMs === null) return [];
  const len = clipEndMs - clipStartMs;
  return annotations
    .filter((a) => insideClip(a, { start_ms: clipStartMs, end_ms: clipEndMs }))
    .map((a) => ({
      start_ms: Math.max(0, a.start_ms - clipStartMs),
      end_ms: Math.min(len, a.end_ms - clipStartMs),
      strokes: a.strokes.map((s) => ({ color: s.color, points: s.points })),
    }))
    .sort((a, b) => a.start_ms - b.start_ms);
}

/** Drawings showing at `ms` (end exclusive). */
export function activeAt<T extends { start_ms: number; end_ms: number }>(annotations: readonly T[], ms: number): T[] {
  return annotations.filter((a) => ms >= a.start_ms && ms < a.end_ms);
}

/** 0..1 opacity with a short fade in and out, so marks don't pop. */
export function opacityAt(a: { start_ms: number; end_ms: number }, ms: number, fadeMs = 150): number {
  if (ms < a.start_ms || ms >= a.end_ms) return 0;
  const f = Math.min(fadeMs, (a.end_ms - a.start_ms) / 4);
  if (f <= 0) return 1;
  return Math.min(1, (ms - a.start_ms) / f, (a.end_ms - ms) / f);
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the frame actually sits inside a box that shows the video with
 * `object-fit: contain` (letterboxed). Unknown video size -> the whole box.
 */
export function containRect(boxW: number, boxH: number, videoW: number, videoH: number): Rect {
  if (!(boxW > 0 && boxH > 0 && videoW > 0 && videoH > 0)) return { left: 0, top: 0, width: Math.max(0, boxW), height: Math.max(0, boxH) };
  const scale = Math.min(boxW / videoW, boxH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Drop points closer than `minDist` to the last kept one (in frame units) and
 * round to 4 decimals. The last point is always kept so the stroke ends where
 * the pen lifted.
 */
export function simplifyPoints(points: readonly Point[], minDist = 0.003): Point[] {
  const out: Point[] = [];
  for (const [x, y] of points) {
    const p: Point = [round4(clamp01(x)), round4(clamp01(y))];
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) out.push(p);
  }
  const end = points[points.length - 1];
  if (end && out.length > 1) {
    const p: Point = [round4(clamp01(end[0])), round4(clamp01(end[1]))];
    const last = out[out.length - 1];
    if (last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

/**
 * Smooth SVG path through the points, in a 0..1 viewBox: quadratic curves
 * through the midpoints. A single point becomes a dot (a zero-length line
 * with round caps).
 */
export function strokePath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const f = (n: number) => String(round4(n));
  const [x0, y0] = points[0];
  if (points.length === 1) return `M${f(x0)} ${f(y0)}L${f(x0)} ${f(y0)}`;
  if (points.length === 2) return `M${f(x0)} ${f(y0)}L${f(points[1][0])} ${f(points[1][1])}`;
  let d = `M${f(x0)} ${f(y0)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += `Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d}L${f(lx)} ${f(ly)}`;
}
