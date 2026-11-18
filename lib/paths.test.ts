import { describe, expect, it } from "vitest";
import { isOverwritablePath, storagePaths } from "./paths";

const id = "a38fdcb6-0b41-4e53-90c3-95f12018ab57";

describe("isOverwritablePath", () => {
  it("is true for recording pieces (a retake reuses the path)", () => {
    expect(isOverwritablePath(storagePaths.segment(id, 1, "video/mp4"))).toBe(true);
    expect(isOverwritablePath(storagePaths.segment(id, 12, "video/webm"))).toBe(true);
  });

  it("is false for files that are never overwritten", () => {
    expect(isOverwritablePath(storagePaths.stitched(id))).toBe(false);
    expect(isOverwritablePath(storagePaths.clip(id, "c1", 3))).toBe(false);
    expect(isOverwritablePath(storagePaths.frame(id, "f1"))).toBe(false);
  });
});
