/** Shared studio types and pure range helpers. */
import { clampMs } from "@/lib/editor/clipRange";
import type { ClipDetail, LineDetail } from "@/lib/types/api";

export interface Range {
  start: number;
  end: number;
}

/** What the inspector shows: a line, and one of its clips, a new clip, or none. */
export interface Selection {
  lineId: string;
  clipId: string | "new" | null;
}

export type InspectorTab = "clip" | "line" | "details";

/** Draft key for a clip range (or a line's new clip). */
export const clipKey = (lineId: string, clipId: string | "new") => `${lineId}:${clipId}`;

/** Length used when only one end is set. */
export const DEFAULT_LEN_MS = 5000;
/** Shortest range the timeline handles allow. */
export const MIN_LEN_MS = 500;

/** Move the start, keeping the end after it (or defaulting it). */
export function withStart(r: Range | null, ms: number, durationMs: number): Range {
  const start = clampMs(ms, durationMs);
  const end = r && r.end > start ? r.end : clampMs(start + DEFAULT_LEN_MS, durationMs);
  return { start, end };
}

/** Move the end, keeping the start before it (or defaulting it). */
export function withEnd(r: Range | null, ms: number, durationMs: number): Range {
  const end = clampMs(ms, durationMs);
  const start = r && r.start < end ? r.start : clampMs(end - DEFAULT_LEN_MS, durationMs);
  return { start, end };
}

/** A line's clips in time order (the studio never orders clips by hand). */
export function clipsByTime(line: LineDetail): ClipDetail[] {
  return [...line.clips].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
}

/** 1-based number of a clip within its line, by time. */
export function clipNumber(line: LineDetail, clipId: string): number {
  return clipsByTime(line).findIndex((c) => c.id === clipId) + 1;
}
