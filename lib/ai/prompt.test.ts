import { describe, expect, it } from "vitest";
import { buildPrompt, formatMmSs } from "./prompt";
import { responseSchema } from "./responseSchema";
import { rawAnalysisSchema } from "./types";

describe("buildPrompt", () => {
  it("formats durations as M:SS", () => {
    expect(formatMmSs(0)).toBe("0:00");
    expect(formatMmSs(65_400)).toBe("1:05");
    expect(formatMmSs(600_000)).toBe("10:00");
  });

  it("describes a multi-part recording with its cut points", () => {
    const p = buildPrompt({ duration_ms: 36_000, segment_starts_ms: [0, 20_000] });
    expect(p).toContain("The video is 0:36 long.");
    expect(p).toContain("recorded in 2 parts that were joined together; the parts start at 0:00, 0:20.");
    expect(p).toContain("cuts, not continuous footage");
  });

  it("describes a single-part recording without a parts list", () => {
    const p = buildPrompt({ duration_ms: 90_000, segment_starts_ms: [0] });
    expect(p).toContain("one continuous part");
    expect(p).not.toContain("parts start at");
  });

  it("keeps the grounding rules", () => {
    const p = buildPrompt({ duration_ms: 1000, segment_starts_ms: [0] });
    expect(p).toContain("Use ONLY what was said");
    expect(p).toContain("Keep any numbers exactly as spoken");
  });
});

describe("responseSchema", () => {
  it("matches rawAnalysisSchema's fields and enums", () => {
    const line = responseSchema.properties!.lines.items!;
    const rawLine = rawAnalysisSchema.shape.lines.element;
    expect(Object.keys(line.properties!).sort()).toEqual(Object.keys(rawLine.shape).sort());
    expect([...line.required!].sort()).toEqual(Object.keys(rawLine.shape).sort());
    expect(line.properties!.rating.enum).toEqual(rawLine.shape.rating.options);
    expect(line.properties!.rating_basis.enum).toEqual(rawLine.shape.rating_basis.options);
    const mention = line.properties!.mentions.items!;
    const rawMention = rawLine.shape.mentions.element;
    expect(Object.keys(mention.properties!).sort()).toEqual(Object.keys(rawMention.shape).sort());
    expect([...mention.required!].sort()).toEqual(Object.keys(rawMention.shape).sort());
    const seg = responseSchema.properties!.transcript.items!;
    const rawSeg = rawAnalysisSchema.shape.transcript.unwrap().element;
    expect(Object.keys(seg.properties!).sort()).toEqual(Object.keys(rawSeg.shape).sort());
    expect([...seg.required!].sort()).toEqual(Object.keys(rawSeg.shape).sort());
  });
});
