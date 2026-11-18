"use client";
/**
 * The drawing surface: sits exactly on the video frame and turns pointer drags
 * (mouse, pen or finger) into strokes in 0..1 frame coordinates.
 */
import { useRef, useState } from "react";
import { simplifyPoints, type AnnotationColor, type Point, type Stroke } from "@/lib/annotations";
import { StrokesSvg } from "./StrokesSvg";
import { useFrameRect } from "./useFrameRect";

export function DrawLayer({
  videoRef,
  color,
  strokes,
  onChange,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  color: AnnotationColor;
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
}) {
  const rect = useFrameRect(videoRef);
  const [live, setLive] = useState<Point[] | null>(null);
  const pointer = useRef<number | null>(null);

  if (!rect) return null;

  const at = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const finish = () => {
    if (live && live.length > 0) onChange([...strokes, { color, points: simplifyPoints(live) }]);
    setLive(null);
    pointer.current = null;
  };

  const shown: Stroke[] = live ? [...strokes, { color, points: live }] : strokes;

  return (
    <div
      role="img"
      aria-label="Drawing area. Drag on the video to draw."
      // select-none + no callout: a long press on iOS must not start a selection or the Copy/Look Up menu.
      className="absolute cursor-crosshair touch-none outline-2 outline-amber-fg outline-dashed select-none [-webkit-touch-callout:none]"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerDown={(e) => {
        if (e.button !== 0 || pointer.current !== null) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not an active pointer (e.g. a synthetic event): draw without capture.
        }
        pointer.current = e.pointerId;
        setLive([at(e)]);
      }}
      onPointerMove={(e) => {
        if (pointer.current !== e.pointerId) return;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
        const r = e.currentTarget.getBoundingClientRect();
        const pts: Point[] = events.length
          ? events.map((ev) => [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height])
          : [at(e)];
        setLive((l) => (l ? [...l, ...pts] : l));
      }}
      onPointerUp={(e) => pointer.current === e.pointerId && finish()}
      onPointerCancel={(e) => pointer.current === e.pointerId && finish()}
      // The browser took the touch away (e.g. a system gesture): end the stroke so the pen isn't stuck.
      onLostPointerCapture={(e) => pointer.current === e.pointerId && finish()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <StrokesSvg strokes={shown} width={rect.width} height={rect.height} />
    </div>
  );
}
