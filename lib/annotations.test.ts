import { describe, expect, it } from "vitest";
import {
  activeAt,
  annotationsSchema,
  containRect,
  newAnnotationWindow,
  opacityAt,
  simplifyPoints,
  strokePath,
  toClipTime,
  type Annotation,
} from "./annotations";

const stroke = { color: "red" as const, points: [[0.1, 0.1], [0.2, 0.2]] as [number, number][] };
const ann = (id: string, start_ms: number, end_ms: number): Annotation => ({ id, start_ms, end_ms, strokes: [stroke] });

describe("toClipTime", () => {
  it("keeps overlapping drawings, shifts to clip time, clamps, drops ids, sorts", () => {
    const list = [ann("c", 14_000, 16_000), ann("a", 9_000, 11_000), ann("b", 11_000, 12_000), ann("x", 2_000, 4_000)];
    expect(toClipTime(list, 10_000, 15_000)).toEqual([
      { start_ms: 0, end_ms: 1_000, strokes: [stroke] },
      { start_ms: 1_000, end_ms: 2_000, strokes: [stroke] },
      { start_ms: 4_000, end_ms: 5_000, strokes: [stroke] },
    ]);
  });

  it("drops drawings that only touch the edge", () => {
    expect(toClipTime([ann("a", 5_000, 10_000), ann("b", 15_000, 16_000)], 10_000, 15_000)).toEqual([]);
  });

  it("returns [] without a range (versions sent before annotations existed)", () => {
    expect(toClipTime([ann("a", 0, 1000)], null, null)).toEqual([]);
    expect(toClipTime(null, 0, 1000)).toEqual([]);
  });
});

describe("newAnnotationWindow", () => {
  const clip = { start_ms: 10_000, end_ms: 20_000 };
  it("starts at the playhead for the default 3 s", () => {
    expect(newAnnotationWindow(12_000, clip)).toEqual({ start_ms: 12_000, end_ms: 15_000 });
  });
  it("moves back to fit before the clip's end", () => {
    expect(newAnnotationWindow(19_500, clip)).toEqual({ start_ms: 17_000, end_ms: 20_000 });
  });
  it("never exceeds a short clip", () => {
    expect(newAnnotationWindow(10_500, { start_ms: 10_000, end_ms: 11_000 }, 5_000)).toEqual({ start_ms: 10_000, end_ms: 11_000 });
  });
});

describe("activeAt / opacityAt", () => {
  it("is end-exclusive", () => {
    const list = [ann("a", 1000, 2000)];
    expect(activeAt(list, 999)).toHaveLength(0);
    expect(activeAt(list, 1000)).toHaveLength(1);
    expect(activeAt(list, 2000)).toHaveLength(0);
  });
  it("fades in and out", () => {
    const a = { start_ms: 1000, end_ms: 4000 };
    expect(opacityAt(a, 1000)).toBe(0);
    expect(opacityAt(a, 1075)).toBeCloseTo(0.5);
    expect(opacityAt(a, 2500)).toBe(1);
    expect(opacityAt(a, 4000)).toBe(0);
  });
});

describe("containRect", () => {
  it("pillarboxes portrait video in a landscape box", () => {
    expect(containRect(1600, 900, 720, 1280)).toEqual({ left: (1600 - 506.25) / 2, top: 0, width: 506.25, height: 900 });
  });
  it("letterboxes landscape video in a tall box", () => {
    expect(containRect(400, 800, 1280, 720)).toEqual({ left: 0, top: 287.5, width: 400, height: 225 });
  });
  it("falls back to the box when the video size is unknown", () => {
    expect(containRect(300, 200, 0, 0)).toEqual({ left: 0, top: 0, width: 300, height: 200 });
  });
});

describe("simplifyPoints / strokePath", () => {
  it("drops near points, rounds, clamps, keeps the last point", () => {
    expect(
      simplifyPoints([
        [0.1, 0.1],
        [0.1001, 0.1001],
        [0.2, 0.2],
        [0.20012345, 0.2],
        [1.2, -0.1],
      ]),
    ).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
      [1, 0],
    ]);
  });
  it("keeps a single tap as one point and draws it as a dot", () => {
    expect(simplifyPoints([[0.5, 0.5]])).toEqual([[0.5, 0.5]]);
    expect(strokePath([[0.5, 0.5]])).toBe("M0.5 0.5L0.5 0.5");
  });
  it("smooths through midpoints", () => {
    expect(strokePath([[0, 0], [0.5, 0.5], [1, 0]])).toBe("M0 0Q0.5 0.5 0.75 0.25L1 0");
  });
});

describe("annotationsSchema", () => {
  it("accepts a valid list", () => {
    expect(annotationsSchema.safeParse([ann("a", 0, 3000)]).success).toBe(true);
  });
  it("rejects bad colors, coordinates, windows, empty strokes and duplicate ids", () => {
    const bad = [
      [{ ...ann("a", 0, 3000), strokes: [{ color: "blue", points: [[0, 0]] }] }],
      [{ ...ann("a", 0, 3000), strokes: [{ color: "red", points: [[1.5, 0]] }] }],
      [ann("a", 3000, 3000)],
      [ann("a", 0, 11_000)],
      [{ ...ann("a", 0, 3000), strokes: [] }],
      [ann("a", 0, 1000), ann("a", 1000, 2000)],
      [{ ...ann("a", 0, 1000), extra: 1 }],
    ];
    for (const b of bad) expect(annotationsSchema.safeParse(b).success).toBe(false);
  });
  it("caps the count and total points", () => {
    expect(annotationsSchema.safeParse(Array.from({ length: 21 }, (_, i) => ann(`a${i}`, i * 1000, i * 1000 + 500))).success).toBe(false);
    const many = { color: "red" as const, points: Array.from({ length: 20_001 }, () => [0.5, 0.5] as [number, number]) };
    expect(annotationsSchema.safeParse([{ ...ann("a", 0, 1000), strokes: [many] }]).success).toBe(false);
  });
});
