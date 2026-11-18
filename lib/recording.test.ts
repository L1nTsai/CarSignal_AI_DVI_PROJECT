import { describe, expect, it } from "vitest";
import { recorderStalled, RECORDER_TIMESLICE_MS, type ChunkMark } from "./recording";

/** Chunks every timeslice from `from` to `to` ms at `kbps` KB per second. */
function chunks(from: number, to: number, kbPerSec: number): ChunkMark[] {
  const out: ChunkMark[] = [];
  for (let t = from + RECORDER_TIMESLICE_MS; t <= to; t += RECORDER_TIMESLICE_MS)
    out.push({ t, bytes: (kbPerSec * 1024 * RECORDER_TIMESLICE_MS) / 1000 });
  return out;
}

describe("recorderStalled", () => {
  it("is fine while video is being written", () => {
    expect(recorderStalled(chunks(0, 10_000, 220), 10_000, 0)).toBe(false);
  });
  it("trips when only sound is arriving", () => {
    const c = [...chunks(0, 10_000, 300), ...chunks(10_000, 12_500, 23)];
    expect(recorderStalled(c, 12_500, 0)).toBe(true);
  });
  it("says nothing when no data arrived (batched chunks)", () => {
    expect(recorderStalled(chunks(0, 5_000, 300), 8_000, 0)).toBe(false);
  });
  it("waits for the take to settle", () => {
    expect(recorderStalled(chunks(0, 2_000, 23), 2_000, 0)).toBe(false);
  });
});
