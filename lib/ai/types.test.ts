import { describe, expect, it } from "vitest";
import { assertValidatedAnalysis, type ValidatedAnalysis } from "./types";

const ok: ValidatedAnalysis = {
  model: "m",
  dropped: [],
  transcript: [
    { text: "Left front tire, inner edge is worn.", start_ms: 1000, end_ms: 3500 },
    { text: "Wipers, these look good.", start_ms: 5000, end_ms: 6500 },
  ],
  lines: [
    { component_name: "Left Front Tire", rating: "needs_attention", rating_basis: "stated", note: "Worn.", car_zone: "wheel_lf",
      mentions: [{ quote: "inner edge is worn", visible_start_ms: 1000, visible_end_ms: 4000, best_frame_ms: 2000 }] },
    { component_name: "Wipers", rating: "good", rating_basis: "inferred", note: "Look good.", car_zone: "windshield",
      mentions: [{ quote: "these look good", visible_start_ms: 5000, visible_end_ms: 7000, best_frame_ms: 6000 }] },
  ],
};

describe("ValidatedAnalysis contract", () => {
  it("accepts a valid analysis", () => {
    expect(assertValidatedAnalysis(ok, 10_000)).toEqual(ok);
  });
  it("rejects best frame outside the visible span", () => {
    const bad = structuredClone(ok);
    bad.lines[0].mentions[0].best_frame_ms = 9000;
    expect(() => assertValidatedAnalysis(bad, 10_000)).toThrow();
  });
  it("rejects times past the end of the video", () => {
    expect(() => assertValidatedAnalysis(ok, 6000)).toThrow(/past end/);
  });
  it("rejects lines out of first-appearance order", () => {
    const bad = { ...ok, lines: [ok.lines[1], ok.lines[0]] };
    expect(() => assertValidatedAnalysis(bad, 10_000)).toThrow(/sorted/);
  });
  it("rejects empty quotes and no lines", () => {
    const bad = structuredClone(ok);
    bad.lines[0].mentions[0].quote = "  ";
    expect(() => assertValidatedAnalysis(bad, 10_000)).toThrow();
    expect(() => assertValidatedAnalysis({ ...ok, lines: [] }, 10_000)).toThrow();
  });
  it("rejects overlapping or out-of-range transcript segments", () => {
    const overlap = { ...ok, transcript: [ok.transcript[0], { text: "x", start_ms: 3000, end_ms: 4000 }] };
    expect(() => assertValidatedAnalysis(overlap, 10_000)).toThrow(/overlap/);
    const late = { ...ok, transcript: [{ text: "x", start_ms: 9000, end_ms: 11_000 }] };
    expect(() => assertValidatedAnalysis(late, 10_000)).toThrow(/past end/);
  });
});
