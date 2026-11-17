import { describe, expect, it } from "vitest";
import { groupByRating, ratingSummary } from "./ratings";

describe("ratings", () => {
  const lines = [
    { id: 1, rating: "good" as const },
    { id: 2, rating: "needs_attention" as const },
    { id: 3, rating: "good" as const },
    { id: 4, rating: "needs_attention" as const },
  ];
  it("groups needs attention first, keeping order", () => {
    expect(groupByRating(lines).map((g) => [g.rating, g.lines.map((l) => l.id)])).toEqual([
      ["needs_attention", [2, 4]],
      ["good", [1, 3]],
    ]);
  });
  it("summarizes counts", () => {
    expect(ratingSummary(lines)).toBe("2 need attention · 2 good");
    expect(ratingSummary([{ rating: "needs_attention" }, { rating: "monitor" }])).toBe("1 needs attention · 1 to monitor");
  });
});
