/**
 * Where on the car a line is: zones on a top-down diagram (front at the top).
 * "Left" is the driver's side, as seen from the driver's seat (US).
 * Pure (zod only); safe anywhere. The same keys are checked in the database
 * (migration 0006) and offered to Gemini (lib/ai/responseSchema.ts).
 */
import { z } from "zod";
import { RATING_ORDER } from "./ratings";
import type { LineRating } from "./types/db";

export const CAR_ZONE_KEYS = [
  "front_bumper",
  "headlight_l",
  "headlight_r",
  "hood_engine",
  "wheel_lf",
  "wheel_rf",
  "mirror_l",
  "mirror_r",
  "windshield",
  "door_lf",
  "door_rf",
  "cabin",
  "door_lr",
  "door_rr",
  "wheel_lr",
  "wheel_rr",
  "rear_window",
  "trunk",
  "taillight_l",
  "taillight_r",
  "rear_bumper",
  "underbody",
] as const;
export type CarZone = (typeof CAR_ZONE_KEYS)[number];

export const CAR_ZONE_LABEL: Record<CarZone, string> = {
  front_bumper: "Front bumper",
  headlight_l: "Left headlight",
  headlight_r: "Right headlight",
  hood_engine: "Hood and engine",
  wheel_lf: "Left front wheel",
  wheel_rf: "Right front wheel",
  mirror_l: "Left mirror",
  mirror_r: "Right mirror",
  windshield: "Windshield",
  door_lf: "Left front door",
  door_rf: "Right front door",
  cabin: "Interior",
  door_lr: "Left rear door",
  door_rr: "Right rear door",
  wheel_lr: "Left rear wheel",
  wheel_rr: "Right rear wheel",
  rear_window: "Rear window",
  trunk: "Trunk",
  taillight_l: "Left taillight",
  taillight_r: "Right taillight",
  rear_bumper: "Rear bumper",
  underbody: "Underneath",
};

export const carZoneSchema = z.enum(CAR_ZONE_KEYS);

export function isCarZone(v: unknown): v is CarZone {
  return typeof v === "string" && (CAR_ZONE_KEYS as readonly string[]).includes(v);
}

type Side = "l" | "r" | null;
type End = "f" | "r" | null;

function sideOf(s: string): Side {
  if (/\b(left|driver|drivers|driver's|lf|lr)\b/.test(s)) return "l";
  if (/\b(right|passenger|passengers|passenger's|rf|rr)\b/.test(s)) return "r";
  return null;
}

function endOf(s: string): End {
  if (/\b(front|lf|rf|fl|fr)\b/.test(s)) return "f";
  if (/\b(rear|back|lr|rr|rl)\b/.test(s)) return "r";
  return null;
}

/**
 * Best guess from a component name, or null when unsure. Used for lines with
 * no zone (tech-added lines, versions sent before zones existed, an AI "none").
 */
export function guessZone(componentName: string): CarZone | null {
  const s = componentName.toLowerCase().replace(/[^a-z0-9' ]+/g, " ");
  const side = sideOf(s);
  const end = endOf(s);
  const has = (re: RegExp) => re.test(s);

  if (has(/\b(tire|tires|tyre|wheel|wheels|tread|brake|brakes|rotor|rotors|caliper|calipers|pads?|strut|shock|hub|bearing|lug)\b/)) {
    if (!side || !end) return null; // "Front Brake Pads", "Tires": no single wheel
    return `wheel_${side}${end}` as CarZone;
  }
  if (has(/\b(headlight|headlights|head light|headlamp|fog light)\b/)) return side ? (`headlight_${side}` as CarZone) : null;
  if (has(/\b(taillight|taillights|tail light|brake light|tail lamp)\b/)) return side ? (`taillight_${side}` as CarZone) : null;
  if (has(/\b(mirror|mirrors)\b/)) return side ? (`mirror_${side}` as CarZone) : null;
  if (has(/\b(door|doors)\b/)) return side && end ? (`door_${side}${end}` as CarZone) : null;
  if (has(/\b(cabin|interior|seat|seats|dash|dashboard|seatbelt|seat belt|ac|a c|hvac|horn)\b/)) return "cabin";
  if (has(/\b(wiper|wipers|windshield|windscreen)\b/)) return end === "r" ? "rear_window" : "windshield";
  if (has(/\b(trunk|hatch|tailgate|spare)\b/)) return "trunk";
  if (has(/\b(exhaust|muffler|catalytic|undercarriage|underbody|cv|axle|driveshaft|fuel line|oil pan|transmission leak)\b/)) return "underbody";
  if (has(/\b(engine|air filter|battery|oil|coolant|radiator|belt|belts|hose|hoses|fluid|fluids|hood|spark|alternator)\b/)) return "hood_engine";
  if (has(/\b(bumper)\b/)) return end === "r" ? "rear_bumper" : end === "f" ? "front_bumper" : null;
  return null;
}

export interface ZoneEntry<T> {
  zone: CarZone;
  /** The worst rating among the zone's lines. */
  rating: LineRating;
  /** In the order given. */
  lines: T[];
}

/** Lines by zone (worst rating per zone), plus the lines that have no zone. */
export function zoneSummary<T extends { car_zone: CarZone | null; rating: LineRating }>(
  lines: readonly T[],
): { zones: Map<CarZone, ZoneEntry<T>>; unplaced: T[] } {
  const zones = new Map<CarZone, ZoneEntry<T>>();
  const unplaced: T[] = [];
  const rank = (r: LineRating) => RATING_ORDER.indexOf(r);
  for (const l of lines) {
    if (!l.car_zone) {
      unplaced.push(l);
      continue;
    }
    const e = zones.get(l.car_zone);
    if (!e) zones.set(l.car_zone, { zone: l.car_zone, rating: l.rating, lines: [l] });
    else {
      e.lines.push(l);
      if (rank(l.rating) < rank(e.rating)) e.rating = l.rating;
    }
  }
  return { zones, unplaced };
}
