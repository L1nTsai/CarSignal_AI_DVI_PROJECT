import { describe, expect, it } from "vitest";
import { changeBadges, diffVersions, isEmptyDiff, type DiffableLine } from "./diff";

const line = (key: string, over: Partial<DiffableLine> = {}): DiffableLine => ({
  key,
  component_name: `Part ${key}`,
  note: `Note ${key}`,
  rating: "good",
  clips: [{}],
  ...over,
});

describe("diffVersions", () => {
  it("reports nothing for identical versions", () => {
    const v = [line("a"), line("b")];
    const d = diffVersions(v, v.map((l) => ({ ...l })));
    expect(isEmptyDiff(d)).toBe(true);
  });

  it("treats a reorder alone as no change", () => {
    const d = diffVersions([line("a"), line("b")], [line("b"), line("a")]);
    expect(isEmptyDiff(d)).toBe(true);
  });

  it("finds added lines in current order", () => {
    const d = diffVersions([line("a")], [line("c"), line("a"), line("b")]);
    expect(d.added.map((l) => l.key)).toEqual(["c", "b"]);
    expect(d.changed).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("finds removed lines in previous order", () => {
    const d = diffVersions([line("a"), line("b"), line("c")], [line("b")]);
    expect(d.removed.map((l) => l.key)).toEqual(["a", "c"]);
    expect(d.added).toEqual([]);
  });

  it("lists changed fields in display order", () => {
    const before = line("a");
    const after = line("a", { note: "Worn more", rating: "needs_attention", component_name: "Left Front Tire", clips: [{}, {}] });
    const d = diffVersions([before], [after]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].fields).toEqual(["component_name", "rating", "note", "clips"]);
    expect(d.changed[0].before).toBe(before);
    expect(d.changed[0].after).toBe(after);
  });

  it("matches by key, so a renamed line is changed, not removed + added", () => {
    const d = diffVersions([line("a", { component_name: "Tire" })], [line("a", { component_name: "Left Front Tire" })]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed[0].fields).toEqual(["component_name"]);
  });

  it("ignores surrounding whitespace in text", () => {
    const d = diffVersions([line("a", { note: "Worn." })], [line("a", { note: "  Worn.\n" })]);
    expect(isEmptyDiff(d)).toBe(true);
  });

  it("handles added, changed and removed together", () => {
    const d = diffVersions(
      [line("keep"), line("edit"), line("gone")],
      [line("keep"), line("edit", { rating: "monitor" }), line("new")],
    );
    expect(d.added.map((l) => l.key)).toEqual(["new"]);
    expect(d.changed.map((c) => c.after.key)).toEqual(["edit"]);
    expect(d.removed.map((l) => l.key)).toEqual(["gone"]);
    expect(Object.fromEntries(changeBadges(d))).toEqual({ new: "new", edit: "updated" });
  });

  it("treats every line as added when there is no previous version", () => {
    const d = diffVersions([], [line("a"), line("b")]);
    expect(d.added).toHaveLength(2);
  });
});
