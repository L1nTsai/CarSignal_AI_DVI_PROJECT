"use client";
/**
 * Where the video's frame is drawn, relative to the <video>'s offset parent.
 * The element letterboxes (object-fit: contain), so the frame can be smaller
 * than the box; overlays and the draw layer sit exactly on the frame.
 */
import { useEffect, useState } from "react";
import { containRect, type Rect } from "@/lib/annotations";

export function useFrameRect(videoRef: React.RefObject<HTMLVideoElement | null>): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const measure = () => {
      const r = containRect(v.clientWidth, v.clientHeight, v.videoWidth, v.videoHeight);
      const next = { left: v.offsetLeft + r.left, top: v.offsetTop + r.top, width: r.width, height: r.height };
      setRect((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    v.addEventListener("loadedmetadata", measure);
    v.addEventListener("resize", measure); // the frame size changed (new source)
    return () => {
      ro.disconnect();
      v.removeEventListener("loadedmetadata", measure);
      v.removeEventListener("resize", measure);
    };
  }, [videoRef]);

  return rect;
}
