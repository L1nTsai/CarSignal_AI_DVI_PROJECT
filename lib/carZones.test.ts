import { describe, expect, it } from "vitest";
import { carZoneSchema, guessZone, zoneSummary, type CarZone } from "./carZones";
import type { LineRating } from "./types/db";

describe("guessZone", () => {
  it.each([
    ["Left Front Tire", "wheel_lf"],
    ["LF tread depth", "wheel_lf"],
    ["Passenger Rear Tire", "wheel_rr"],
    ["Right Rear Brake Rotor", "wheel_rr"],
    ["Right Headlight", "headlight_r"],
    ["Driver Side Mirror", "mirror_l"],
    ["Wipers", "windshield"],
    ["Rear Wiper", "rear_window"],
    ["Engine Air Filter", "hood_engine"],
    ["Coolant", "hood_engine"],
    ["Cabin Air Filter", "cabin"],
    ["Exhaust", "underbody"],
    ["Rear Bumper", "rear_bumper"],
  ])("%s -> %s", (name, zone) => {
    expect(guessZone(name)).toBe(zone);
  });

  it.each(["Front Brake Pads", "Tires", "Headlights", "General condition", "Bumper"])("%s -> null (no single spot)", (name) => {
    expect(guessZone(name)).toBeNull();
  });
});

describe("carZoneSchema", () => {
  it("accepts known keys only", () => {
    expect(carZoneSchema.safeParse("wheel_lf").success).toBe(true);
    expect(carZoneSchema.safeParse("roof").success).toBe(false);
  });
});

describe("zoneSummary", () => {
  const l = (k: string, car_zone: CarZone | null, rating: LineRating) => ({ k, car_zone, rating });
  it("groups by zone with the worst rating, keeps order, lists unplaced lines", () => {
    const lines = [
      l("a", "wheel_lf", "good"),
      l("b", null, "monitor"),
      l("c", "wheel_lf", "needs_attention"),
      l("d", "windshield", "monitor"),
      l("e", "wheel_lf", "monitor"),
    ];
    const { zones, unplaced } = zoneSummary(lines);
    expect(zones.get("wheel_lf")?.rating).toBe("needs_attention");
    expect(zones.get("wheel_lf")?.lines.map((x) => x.k)).toEqual(["a", "c", "e"]);
    expect(zones.get("windshield")?.rating).toBe("monitor");
    expect(unplaced.map((x) => x.k)).toEqual(["b"]);
  });
});
