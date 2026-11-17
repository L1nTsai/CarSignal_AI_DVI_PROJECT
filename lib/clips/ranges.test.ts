import { describe, expect, it } from "vitest";
import { computeClipRanges, pieceAt, type RangeMention, type Timeline } from "./ranges";

const one: Timeline = { duration_ms: 60_000, segment_starts_ms: [0] };
// Two recorded pieces with a pause point at 20 s (like the demo seed).
const two: Timeline = { duration_ms: 36_000, segment_starts_ms: [0, 20_000] };

const m = (line: string | number, vs: number, ve: number, bf = Math.round((vs + ve) / 2)): RangeMention => ({
  line,
  visible_start_ms: vs,
  visible_end_ms: ve,
  best_frame_ms: bf,
});

describe("pieceAt", () => {
  it("finds the piece and assigns a pause point to the later piece", () => {
    expect(pieceAt(5_000, two)).toEqual({ start_ms: 0, end_ms: 20_000 });
    expect(pieceAt(19_999, two)).toEqual({ start_ms: 0, end_ms: 20_000 });
    expect(pieceAt(20_000, two)).toEqual({ start_ms: 20_000, end_ms: 36_000 });
    expect(pieceAt(36_000, two)).toEqual({ start_ms: 20_000, end_ms: 36_000 });
  });

  it("tolerates missing / unsorted / duplicate starts", () => {
    const tl = { duration_ms: 30_000, segment_starts_ms: [20_000, 10_000, 10_000] };
    expect(pieceAt(15_000, tl)).toEqual({ start_ms: 10_000, end_ms: 20_000 });
    expect(pieceAt(1_000, tl)).toEqual({ start_ms: 0, end_ms: 10_000 });
  });
});

describe("computeClipRanges: padding", () => {
  it("pads the visible span by 3 s each side by default", () => {
    expect(computeClipRanges([m("a", 10_000, 14_000)], one)).toEqual([{ start_ms: 7_000, end_ms: 17_000 }]);
  });

  it("uses custom padding", () => {
    const r = computeClipRanges([m("a", 10_000, 14_000)], one, { padBeforeMs: 1000, padAfterMs: 4000, maxMs: 20_000 });
    expect(r).toEqual([{ start_ms: 9_000, end_ms: 18_000 }]);
  });

  it("rounds fractional input to integer ms", () => {
    const [r] = computeClipRanges([m("a", 10_000.4, 14_000.6, 12_000.2)], one);
    expect(Number.isInteger(r.start_ms) && Number.isInteger(r.end_ms)).toBe(true);
  });
});

describe("computeClipRanges: video edges", () => {
  it("clamps to 0 at the start", () => {
    expect(computeClipRanges([m("a", 1_000, 3_000)], one)).toEqual([{ start_ms: 0, end_ms: 6_000 }]);
  });

  it("clamps to duration at the end", () => {
    expect(computeClipRanges([m("a", 57_000, 59_500)], one)).toEqual([{ start_ms: 54_000, end_ms: 60_000 }]);
  });

  it("handles a mention covering the whole (short) video", () => {
    const tl = { duration_ms: 4_000, segment_starts_ms: [0] };
    expect(computeClipRanges([m("a", 0, 4_000)], tl)).toEqual([{ start_ms: 0, end_ms: 4_000 }]);
  });

  it("rejects a zero duration", () => {
    expect(() => computeClipRanges([m("a", 0, 1)], { duration_ms: 0, segment_starts_ms: [0] })).toThrow();
  });
});

describe("computeClipRanges: pause points", () => {
  it("does not extend past the end of the piece", () => {
    expect(computeClipRanges([m("a", 17_000, 19_500, 19_000)], two)).toEqual([{ start_ms: 14_000, end_ms: 20_000 }]);
  });

  it("does not extend before the start of the piece", () => {
    expect(computeClipRanges([m("a", 20_500, 22_000, 21_000)], two)).toEqual([{ start_ms: 20_000, end_ms: 25_000 }]);
  });

  it("uses the piece holding best_frame when the visible span crosses a pause point", () => {
    expect(computeClipRanges([m("a", 18_000, 23_000, 22_000)], two)).toEqual([{ start_ms: 20_000, end_ms: 26_000 }]);
    expect(computeClipRanges([m("a", 18_000, 23_000, 19_000)], two)).toEqual([{ start_ms: 15_000, end_ms: 20_000 }]);
  });

  it("puts a best_frame exactly on the pause point in the later piece", () => {
    expect(computeClipRanges([m("a", 19_000, 21_000, 20_000)], two)).toEqual([{ start_ms: 20_000, end_ms: 24_000 }]);
  });

  it("never lets a clip span a pause point, across many pieces", () => {
    const tl = { duration_ms: 30_000, segment_starts_ms: [0, 5_000, 10_000, 15_000, 20_000, 25_000] };
    const mentions = [m("a", 4_000, 6_000, 6_000), m("b", 9_000, 11_000, 9_500), m("c", 14_900, 15_100, 15_000)];
    for (const r of computeClipRanges(mentions, tl)) {
      const p = pieceAt(r.start_ms, tl);
      expect(r.end_ms).toBeLessThanOrEqual(p.end_ms);
    }
  });

  it("leaves neighbours in different pieces alone", () => {
    const r = computeClipRanges([m("a", 18_000, 19_500), m("b", 20_500, 22_000)], two);
    expect(r).toEqual([
      { start_ms: 15_000, end_ms: 20_000 },
      { start_ms: 20_000, end_ms: 25_000 },
    ]);
  });
});

describe("computeClipRanges: overlap with neighbours", () => {
  it("splits overlapping padded ranges of different lines at the midpoint", () => {
    // padded: a [7000, 15000], b [11000, 19000]; midpoint(12000, 14000) = 13000
    const r = computeClipRanges([m("a", 10_000, 12_000), m("b", 14_000, 16_000)], one);
    expect(r).toEqual([
      { start_ms: 7_000, end_ms: 13_000 },
      { start_ms: 13_000, end_ms: 19_000 },
    ]);
  });

  it("does not split mentions of the same line", () => {
    const r = computeClipRanges([m("a", 10_000, 12_000), m("a", 14_000, 16_000)], one);
    expect(r).toEqual([
      { start_ms: 7_000, end_ms: 15_000 },
      { start_ms: 11_000, end_ms: 19_000 },
    ]);
  });

  it("never cuts into a visible span; overlapping visible spans keep their overlap", () => {
    const r = computeClipRanges([m("a", 10_000, 15_000), m("b", 14_000, 18_000)], one);
    expect(r).toEqual([
      { start_ms: 7_000, end_ms: 15_000 },
      { start_ms: 14_000, end_ms: 21_000 },
    ]);
  });

  it("leaves non-overlapping neighbours untouched", () => {
    const r = computeClipRanges([m("a", 10_000, 12_000), m("b", 20_000, 22_000)], one);
    expect(r).toEqual([
      { start_ms: 7_000, end_ms: 15_000 },
      { start_ms: 17_000, end_ms: 25_000 },
    ]);
  });

  it("sorts by visible_start internally but returns input order", () => {
    // Line order (by first mention) differs from timeline order: a@30s, b@10s, a@12s.
    const r = computeClipRanges([m("a", 30_000, 32_000), m("b", 10_000, 12_000), m("a", 14_000, 16_000)], one);
    expect(r).toEqual([
      { start_ms: 27_000, end_ms: 35_000 },
      { start_ms: 7_000, end_ms: 13_000 },
      { start_ms: 13_000, end_ms: 19_000 },
    ]);
  });

  it("handles a chain of three different lines", () => {
    const r = computeClipRanges([m("a", 10_000, 11_000), m("b", 12_000, 13_000), m("c", 14_000, 15_000)], one);
    expect(r).toEqual([
      { start_ms: 7_000, end_ms: 11_500 },
      { start_ms: 11_500, end_ms: 13_500 },
      { start_ms: 13_500, end_ms: 18_000 },
    ]);
    for (let i = 0; i + 1 < r.length; i++) expect(r[i].end_ms).toBeLessThanOrEqual(r[i + 1].start_ms);
  });
});

describe("computeClipRanges: max length", () => {
  it("takes a MAX window centred on best_frame", () => {
    // padded [7000, 43000] = 36 s > 20 s
    expect(computeClipRanges([m("a", 10_000, 40_000, 30_000)], one)).toEqual([{ start_ms: 20_000, end_ms: 40_000 }]);
  });

  it("keeps the window inside the range when best_frame is near an edge", () => {
    expect(computeClipRanges([m("a", 10_000, 40_000, 10_000)], one)).toEqual([{ start_ms: 7_000, end_ms: 27_000 }]);
    expect(computeClipRanges([m("a", 10_000, 40_000, 40_000)], one)).toEqual([{ start_ms: 23_000, end_ms: 43_000 }]);
  });

  it("leaves a range exactly MAX long alone", () => {
    expect(computeClipRanges([m("a", 10_000, 24_000)], one)).toEqual([{ start_ms: 7_000, end_ms: 27_000 }]);
  });

  it("never exceeds the 60 s database limit, whatever MAX says", () => {
    const tl = { duration_ms: 300_000, segment_starts_ms: [0] };
    const [r] = computeClipRanges([m("a", 10_000, 200_000)], tl, { padBeforeMs: 3000, padAfterMs: 3000, maxMs: 999_999 });
    expect(r.end_ms - r.start_ms).toBe(60_000);
  });

  it("always returns end > start within the video", () => {
    const tl = { duration_ms: 25_000, segment_starts_ms: [0, 12_000, 12_500] };
    const mentions = [m("a", 0, 1), m("b", 12_000, 12_400, 12_200), m("c", 24_000, 25_000, 25_000), m("d", 11_000, 13_000, 12_499)];
    for (const r of computeClipRanges(mentions, tl)) {
      expect(r.end_ms).toBeGreaterThan(r.start_ms);
      expect(r.start_ms).toBeGreaterThanOrEqual(0);
      expect(r.end_ms).toBeLessThanOrEqual(25_000);
    }
  });
});
