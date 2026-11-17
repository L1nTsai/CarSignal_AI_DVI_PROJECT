import { describe, expect, it } from "vitest";
import { candidateFrameTimes, needsNewThumbnail, sharpestIndex } from "./frames";

describe("candidateFrameTimes", () => {
  it("AI clip: best_frame ±500/±1000", () => {
    expect(candidateFrameTimes({ start_ms: 7_000, end_ms: 17_000 }, 12_000)).toEqual([11_000, 11_500, 12_000, 12_500, 13_000]);
  });

  it("AI clip: keeps frames inside the clip and drops duplicates", () => {
    expect(candidateFrameTimes({ start_ms: 20_000, end_ms: 25_000 }, 20_200)).toEqual([20_000, 20_200, 20_700, 21_200]);
    // near the end, frames stop 100 ms before end_ms
    expect(candidateFrameTimes({ start_ms: 0, end_ms: 6_000 }, 5_900)).toEqual([4_900, 5_400, 5_900]);
  });

  it("tech clip: 5 evenly spaced frames", () => {
    expect(candidateFrameTimes({ start_ms: 10_000, end_ms: 20_000 }, null)).toEqual([11_000, 13_000, 15_000, 17_000, 19_000]);
  });

  it("falls back to even spacing when best_frame is outside a re-ranged clip", () => {
    expect(candidateFrameTimes({ start_ms: 0, end_ms: 5_000 }, 30_000)).toEqual([500, 1_500, 2_500, 3_500, 4_500]);
  });

  it("all times lie inside the clip", () => {
    for (const [s, e, bf] of [[0, 300, 150], [1000, 1200, null], [5000, 9000, 5000]] as const) {
      for (const t of candidateFrameTimes({ start_ms: s, end_ms: e }, bf)) {
        expect(t).toBeGreaterThanOrEqual(s);
        expect(t).toBeLessThan(e);
      }
    }
  });
});

describe("needsNewThumbnail", () => {
  const clip = { start_ms: 1_000, end_ms: 5_000 };
  it("is true without a thumbnail or when it is out of range", () => {
    expect(needsNewThumbnail(clip, null)).toBe(true);
    expect(needsNewThumbnail(clip, 999)).toBe(true);
    expect(needsNewThumbnail(clip, 5_001)).toBe(true);
  });
  it("is false when the current thumbnail is still inside", () => {
    expect(needsNewThumbnail(clip, 1_000)).toBe(false);
    expect(needsNewThumbnail(clip, 3_000)).toBe(false);
  });
});

describe("sharpestIndex", () => {
  it("picks the max, first on ties, -1 when empty", () => {
    expect(sharpestIndex([1, 5, 3])).toBe(1);
    expect(sharpestIndex([2, 2])).toBe(0);
    expect(sharpestIndex([])).toBe(-1);
  });
});
