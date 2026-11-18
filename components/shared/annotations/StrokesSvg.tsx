/**
 * Strokes drawn over the video frame. The SVG works in the frame's own pixels
 * (viewBox = width × height), so stroke widths are plain pixels, proportional
 * to the frame's height, with a thin dark outline so the marks read on any
 * background.
 *
 * Pixels rather than a stretched 0..1 viewBox with `vector-effect:
 * non-scaling-stroke`: iOS Safari draws the round cap of a zero-length path
 * (a finger held still) in viewBox units under that effect, which turned one
 * dot into a red disc many times the size of the video. A dot is drawn as a
 * circle for the same reason.
 */
import { ANNOTATION_COLORS, STROKE_WIDTH, strokePath, type Point, type Stroke } from "@/lib/annotations";

export function StrokesSvg({
  strokes,
  width,
  height,
  style,
}: {
  strokes: readonly Stroke[];
  /** The video frame's size on screen, px. */
  width: number;
  height: number;
  style?: React.CSSProperties;
}) {
  const w = Math.max(2, height * STROKE_WIDTH);
  const outline = "rgb(0 0 0 / 0.55)";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 size-full overflow-visible" style={style}>
      {strokes.map((s, i) => {
        const color = ANNOTATION_COLORS[s.color].css;
        const pts: Point[] = s.points.map(([x, y]) => [x * width, y * height]);
        if (pts.length === 0) return null;
        if (isDot(pts)) {
          const [cx, cy] = pts[0];
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={(w + 2.5) / 2} fill={outline} />
              <circle cx={cx} cy={cy} r={w / 2} fill={color} />
            </g>
          );
        }
        const d = strokePath(pts);
        return (
          <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={d} stroke={outline} strokeWidth={w + 2.5} />
            <path d={d} stroke={color} strokeWidth={w} />
          </g>
        );
      })}
    </svg>
  );
}

/** Every point within half a pixel of the first: nothing to draw a line along. */
function isDot(pts: readonly Point[]): boolean {
  const [x0, y0] = pts[0];
  return pts.every(([x, y]) => Math.abs(x - x0) < 0.5 && Math.abs(y - y0) < 0.5);
}
