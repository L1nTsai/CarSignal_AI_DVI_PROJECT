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

/** 83_000 -> "1:23" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
