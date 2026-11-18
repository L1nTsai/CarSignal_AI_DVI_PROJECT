import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertValidatedAnalysis, type ValidatedAnalysis } from "./types";
import { normalizeZone, parseModelJson, repairAnalysis, repairSpan, repairTranscript, type RepairResult } from "./validate";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", name), "utf8"));

function expectOk(r: RepairResult, duration_ms: number): ValidatedAnalysis {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}: ${r.message}`);
  // Whatever we return must satisfy the worker-side contract check.
  return assertValidatedAnalysis(r.analysis, duration_ms);
}

describe("repairAnalysis: brief examples", () => {
  const a = expectOk(repairAnalysis(fixture("brief-tire-wipers.json"), { duration_ms: 30_000, model: "m" }), 30_000);

  it("converts seconds to ms and orders lines by first mention", () => {
    expect(a.lines.map((l) => l.component_name)).toEqual(["Left Front Tire", "Wipers"]);
    expect(a.lines[0].mentions[0]).toEqual({
      quote: "The inner edge is worn. Mark it needs attention.",
      visible_start_ms: 3000,
      visible_end_ms: 9000,
      best_frame_ms: 6000,
    });
  });

  it("keeps ratings and basis", () => {
    expect(a.lines[0]).toMatchObject({ rating: "needs_attention", rating_basis: "stated" });
    expect(a.lines[1]).toMatchObject({ rating: "good", rating_basis: "inferred" });
    expect(a.model).toBe("m");
    expect(a.dropped).toEqual([]);
  });
});

describe("repairAnalysis: bad timestamps", () => {
  const duration_ms = 36_000;
  const a = expectOk(repairAnalysis(fixture("bad-timestamps.json"), { duration_ms, model: "m" }), duration_ms);
  const byName = Object.fromEntries(a.lines.map((l) => [l.component_name, l]));

  it("normalizes whitespace in names and notes", () => {
    expect(byName["Left Front Tire"]).toBeDefined();
    expect(byName["Left Front Tire"].note).toBe("Inner edge is worn.");
  });

  it("clamps negatives to 0 and sorts mentions within a line", () => {
    expect(byName["Left Front Tire"].mentions).toEqual([
      { quote: "The inner edge is worn.", visible_start_ms: 0, visible_end_ms: 4200, best_frame_ms: 0 },
      { quote: "Coming back to that tire, it's at 3/32.", visible_start_ms: 25_000, visible_end_ms: 28_000, best_frame_ms: 28_000 },
    ]);
  });

  it("end == start -> end = start + 1000, best clamped into span", () => {
    expect(byName.Wipers.mentions[0]).toMatchObject({ visible_start_ms: 12_000, visible_end_ms: 13_000, best_frame_ms: 13_000 });
  });

  it("end < start -> end = start + 1000", () => {
    expect(byName["Rear Bumper"].mentions[0]).toMatchObject({ visible_start_ms: 33_000, visible_end_ms: 34_000, best_frame_ms: 33_000 });
  });

  it("clamps past-the-end times to duration", () => {
    expect(byName["Tail Lights"].mentions[0]).toMatchObject({ visible_start_ms: 35_400, visible_end_ms: 36_000, best_frame_ms: 36_000 });
  });

  it("orders lines by first mention", () => {
    expect(a.lines.map((l) => l.component_name)).toEqual(["Left Front Tire", "Wipers", "Rear Bumper", "Tail Lights"]);
  });
});

describe("repairSpan edge cases", () => {
  it("a mention at the very end grows backwards", () => {
    expect(repairSpan(40, 41, 40, 36_000)).toEqual({ visible_start_ms: 35_000, visible_end_ms: 36_000, best_frame_ms: 36_000 });
  });
  it("rounds fractional seconds to integer ms", () => {
    expect(repairSpan(1.0004, 2.9996, 2.0001, 10_000)).toEqual({ visible_start_ms: 1000, visible_end_ms: 3000, best_frame_ms: 2000 });
  });
  it("a short video is never exceeded", () => {
    expect(repairSpan(0.5, 0.5, 0.5, 1200)).toEqual({ visible_start_ms: 500, visible_end_ms: 1200, best_frame_ms: 500 });
  });
});

describe("repairAnalysis: empty quotes and mention-less lines", () => {
  const r = repairAnalysis(fixture("empty-quotes.json"), { duration_ms: 60_000, model: "m" });
  const a = expectOk(r, 60_000);

  it("drops empty-quote mentions but keeps the line", () => {
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0].component_name).toBe("Battery");
    expect(a.lines[0].mentions.map((m) => m.quote)).toEqual(["Battery looks fine."]);
  });

  it("drops and reports lines left without mentions or names", () => {
    expect(a.dropped).toEqual([
      { component_name: "Hood", reason: "no usable mentions (empty quotes or bad times)" },
      { component_name: "Windshield", reason: "no mentions" },
      { component_name: "   ", reason: "empty component_name" },
    ]);
  });
});

describe("repairAnalysis: malformed lines", () => {
  const a = expectOk(repairAnalysis(fixture("malformed-lines.json"), { duration_ms: 60_000, model: "m" }), 60_000);

  it("normalizes enum casing", () => {
    expect(a.lines[0]).toMatchObject({ component_name: "Brake Pads", rating: "needs_attention", rating_basis: "stated" });
  });

  it("drops a mention with a null time but keeps the rest of the line", () => {
    expect(a.lines[0].mentions).toHaveLength(1);
  });

  it("drops invalid lines without failing the whole response", () => {
    expect(a.lines).toHaveLength(1);
    expect(a.dropped.map((d) => d.component_name)).toEqual(["Coolant", "(line 3)", "Air Filter"]);
    expect(a.dropped[0].reason).toMatch(/^invalid line \(rating/);
  });
});

describe("repairAnalysis: failures", () => {
  it("no lines -> no_lines", () => {
    const r = repairAnalysis(fixture("no-lines.json"), { duration_ms: 10_000, model: "m" });
    expect(r).toMatchObject({ ok: false, error: "no_lines", dropped: [] });
  });

  it("all lines dropped -> no_lines, with the drops", () => {
    const r = repairAnalysis(
      { lines: [{ component_name: "X", rating: "good", rating_basis: "inferred", note: "", mentions: [] }] },
      { duration_ms: 10_000, model: "m" },
    );
    expect(r).toMatchObject({ ok: false, error: "no_lines", dropped: [{ component_name: "X", reason: "no mentions" }] });
  });

  it.each([null, "text", [], { items: [] }, { lines: "nope" }])("unusable shape %j -> invalid_response", (raw) => {
    expect(repairAnalysis(raw, { duration_ms: 10_000, model: "m" })).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("rejects a nonsensical duration", () => {
    expect(() => repairAnalysis({ lines: [] }, { duration_ms: 0, model: "m" })).toThrow();
  });
});

describe("parseModelJson", () => {
  it("parses plain and fenced JSON", () => {
    expect(parseModelJson('{"lines":[]}')).toEqual({ lines: [] });
    expect(parseModelJson('```json\n{"lines":[]}\n```')).toEqual({ lines: [] });
  });
  it("returns undefined for non-JSON", () => {
    expect(parseModelJson("Sorry, I can't")).toBeUndefined();
  });
});

describe("repairTranscript", () => {
  it("converts to ms, trims text, sorts, and drops unusable segments", () => {
    const t = repairTranscript(
      [
        { text: " Wipers,  these look good. ", start_s: 5, end_s: 6.5 },
        { text: "Left front tire.", start_s: 1, end_s: 2.25 },
        { text: "   ", start_s: 3, end_s: 4 },
        { text: "no times" },
        { text: "Bad", start_s: "x", end_s: 2 },
      ],
      10_000,
    );
    expect(t).toEqual([
      { text: "Left front tire.", start_ms: 1000, end_ms: 2250 },
      { text: "Wipers, these look good.", start_ms: 5000, end_ms: 6500 },
    ]);
  });
  it("clamps to the video, fixes zero-length spans and trims overlaps", () => {
    const t = repairTranscript(
      [
        { text: "a", start_s: 1, end_s: 3 },
        { text: "b", start_s: 2, end_s: 2 },
        { text: "c", start_s: 9.5, end_s: 12 },
      ],
      10_000,
    );
    expect(t).toEqual([
      { text: "a", start_ms: 1000, end_ms: 2000 },
      { text: "b", start_ms: 2000, end_ms: 3000 },
      { text: "c", start_ms: 9500, end_ms: 10_000 },
    ]);
  });
  it("is empty when the response has no transcript, and the lines still come through", () => {
    const r = repairAnalysis(fixture("brief-tire-wipers.json"), { duration_ms: 30_000, model: "m" });
    const a = expectOk(r, 30_000);
    expect(Array.isArray(a.transcript)).toBe(true);
  });
  it("passes the worker-side contract check", () => {
    const raw = {
      transcript: [
        { text: "Left front tire. The inner edge is worn.", start_s: 1.2, end_s: 4 },
        { text: "Wipers look good.", start_s: 3.5, end_s: 6 },
      ],
      lines: [
        {
          component_name: "Left Front Tire",
          rating: "needs_attention",
          rating_basis: "stated",
          note: "Worn.",
          mentions: [{ quote: "The inner edge is worn.", visible_start_s: 1, visible_end_s: 4, best_frame_s: 2 }],
        },
      ],
    };
    const a = expectOk(repairAnalysis(raw, { duration_ms: 10_000, model: "m" }), 10_000);
    expect(a.transcript.map((t) => [t.start_ms, t.end_ms])).toEqual([
      [1200, 3500],
      [3500, 6000],
    ]);
  });
});

describe("normalizeZone", () => {
  it("keeps known zones (case/space-insensitive) and maps none/unknown/missing to null", () => {
    expect(normalizeZone("wheel_lf")).toBe("wheel_lf");
    expect(normalizeZone(" Wheel LF ")).toBe("wheel_lf");
    expect(normalizeZone("none")).toBeNull();
    expect(normalizeZone("roof")).toBeNull();
    expect(normalizeZone(undefined)).toBeNull();
    expect(normalizeZone(3)).toBeNull();
  });
});
