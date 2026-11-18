/** Recording constants and pure helpers (plan §6). Safe in client components. */

/** MediaRecorder format preference: the first supported one wins. */
export const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm",
] as const;

export const VIDEO_BITS_PER_SECOND = 2_500_000;

/** Upper bound on pieces per inspection (each pause makes one). */
export const MAX_SEGMENTS = 200;

/** Pieces shorter than this are dropped (e.g. Pause tapped right after Resume). */
export const MIN_PIECE_MS = 500;

export function pickMimeType(isTypeSupported: (t: string) => boolean): string | null {
  for (const t of MIME_CANDIDATES) {
    try {
      if (isTypeSupported(t)) return t;
    } catch {}
  }
  return null;
}

/** Server-side check of an uploaded piece's content-type. */
export function isAllowedSegmentMime(contentType: string | null): contentType is string {
  if (!contentType) return false;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return base === "video/mp4" || base === "video/webm";
}

/**
 * A piece whose sound runs this much longer than its picture lost its video
 * mid-take. The recorder's own watchdogs end a take within about 2.5 s of a
 * stall, so a gap that small is expected; anything past this is a frozen picture.
 */
export const VIDEO_CUT_TOLERANCE_MS = 3500;

/** MediaRecorder hands over data this often, so the recorder can see a stall. */
export const RECORDER_TIMESLICE_MS = 500;

/**
 * Safari's recorder can stop writing video while the camera and sound carry on
 * (seen twice on iPhone: 10 s and 17 s in). Working video is 220–340 KB/s,
 * sound alone about 23 KB/s. Under this many bytes in STALL_WINDOW_MS while
 * data is still arriving = the video stopped.
 */
export const STALL_WINDOW_MS = 2000;
export const STALL_MIN_BYTES = 70_000;

export interface ChunkMark {
  /** performance.now() when the chunk arrived. */
  t: number;
  bytes: number;
}

/**
 * True when the recorder is still delivering data but too little for video.
 * No data at all in the window says nothing (the browser may batch chunks).
 */
export function recorderStalled(chunks: readonly ChunkMark[], now: number, startedAt: number): boolean {
  if (now - startedAt < STALL_WINDOW_MS + 1000) return false; // first chunk carries headers; let it settle
  let bytes = 0;
  for (const c of chunks) if (c.t > now - STALL_WINDOW_MS) bytes += c.bytes;
  return bytes > 0 && bytes < STALL_MIN_BYTES;
}

/**
 * Where a piece's picture stopped while its sound kept going, or null if the
 * two end together. `videoEndMs` null = no video frames at all.
 */
export function videoCutAt(videoEndMs: number | null, audioEndMs: number | null): number | null {
  if (audioEndMs === null) return null; // no sound to compare against
  const v = videoEndMs ?? 0;
  return audioEndMs - v > VIDEO_CUT_TOLERANCE_MS ? Math.max(0, Math.round(v)) : null;
}

/** 83_000 -> "1:23" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
