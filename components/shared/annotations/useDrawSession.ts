"use client";
/**
 * Editor state for drawing on a clip: the strokes so far, the pen color and
 * how long the drawing shows. Saving adds it to the clip's drawings at the
 * playhead (PATCH /api/clips/[id] { annotations }); it never re-cuts the clip.
 */
import { useState } from "react";
import { apiSend } from "@/lib/fetcher";
import {
  DEFAULT_WINDOW_MS,
  MAX_WINDOW_MS,
  MIN_WINDOW_MS,
  newAnnotationId,
  newAnnotationWindow,
  type Annotation,
  type AnnotationColor,
  type Stroke,
} from "@/lib/annotations";
import type { ClipDetail } from "@/lib/types/api";
import { useAction } from "@/components/shared/editor/context";

export interface DrawState {
  clipId: string;
  strokes: Stroke[];
  color: AnnotationColor;
  windowMs: number;
}

export interface DrawSession {
  state: DrawState | null;
  /** Why Draw is unavailable right now, or null when it can start. */
  blocked: string | null;
  start: () => void;
  cancel: () => void;
  save: () => void;
  setStrokes: (s: Stroke[]) => void;
  setColor: (c: AnnotationColor) => void;
  setWindow: (ms: number) => void;
  undo: () => void;
  clear: () => void;
  saving: boolean;
  error: string | null;
}

export function useDrawSession({
  clip,
  editingRange,
  now,
  pause,
}: {
  /** The selected saved clip, if any. */
  clip: ClipDetail | undefined;
  /** A range edit or new clip is in progress. */
  editingRange: boolean;
  /** Playhead (stitched timeline). */
  now: number;
  pause: () => void;
}): DrawSession {
  const [state, setState] = useState<DrawState | null>(null);
  const [color, setColorPref] = useState<AnnotationColor>("red");
  const [windowMs, setWindowPref] = useState(DEFAULT_WINDOW_MS);
  const action = useAction();

  // The clip went away (deleted, or another one was selected): stop drawing.
  const active = state && clip && state.clipId === clip.id ? state : null;
  if (state && !active) setState(null);

  const blocked = !clip
    ? "Select a clip to draw on it."
    : editingRange
      ? "Save or revert the range first."
      : now < clip.start_ms || now >= clip.end_ms
        ? "Move the playhead inside the clip to draw."
        : null;

  const update = (patch: Partial<DrawState>) => setState((s) => (s ? { ...s, ...patch } : s));

  return {
    state: active,
    blocked,
    start: () => {
      if (blocked || !clip) return;
      pause();
      action.clearError();
      setState({ clipId: clip.id, strokes: [], color, windowMs });
    },
    cancel: () => {
      action.clearError();
      setState(null);
    },
    save: () => {
      if (!active || !clip || active.strokes.length === 0) return;
      const drawing: Annotation = {
        id: newAnnotationId(),
        ...newAnnotationWindow(now, clip, active.windowMs),
        strokes: active.strokes,
      };
      void action
        .run(() => apiSend(`/api/clips/${clip.id}`, "PATCH", { annotations: [...clip.annotations, drawing] }))
        .then((ok) => ok && setState(null));
    },
    setStrokes: (strokes) => update({ strokes }),
    setColor: (c) => {
      setColorPref(c);
      update({ color: c });
    },
    setWindow: (ms) => {
      const w = Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, ms));
      setWindowPref(w);
      update({ windowMs: w });
    },
    undo: () => update({ strokes: active?.strokes.slice(0, -1) ?? [] }),
    clear: () => update({ strokes: [] }),
    saving: action.busy,
    error: action.error,
  };
}

/** Remove one drawing from a clip. */
export function deleteAnnotation(clip: ClipDetail, id: string) {
  return apiSend(`/api/clips/${clip.id}`, "PATCH", { annotations: clip.annotations.filter((a) => a.id !== id) });
}
