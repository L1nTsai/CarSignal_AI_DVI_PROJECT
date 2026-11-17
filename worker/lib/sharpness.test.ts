import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sharpness } from "./video";

let dir: string;
let sharpFile: string;
let softFile: string;
let flatFile: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sharpness-test-"));
  // Deterministic high-detail image: a fine checkerboard with some texture.
  const w = 1280, h = 720;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = ((x >> 2) + (y >> 2)) % 2 ? 230 : 25;
      px.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  const raw = { raw: { width: w, height: h, channels: 3 as const } };
  sharpFile = path.join(dir, "sharp.jpg");
  softFile = path.join(dir, "soft.jpg");
  flatFile = path.join(dir, "flat.jpg");
  await sharp(px, raw).jpeg({ quality: 90 }).toFile(sharpFile);
  await sharp(px, raw).blur(6).jpeg({ quality: 90 }).toFile(softFile);
  await sharp({ create: { width: w, height: h, channels: 3, background: "#808080" } }).jpeg().toFile(flatFile);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sharpness (variance of Laplacian)", () => {
  it("scores a sharp image far above a blurred copy of it", async () => {
    const s = await sharpness(sharpFile);
    const b = await sharpness(softFile);
    expect(s).toBeGreaterThan(b * 10);
  });

  it("is ~0 for a flat image", async () => {
    expect(await sharpness(flatFile)).toBeLessThan(1);
  });
});
