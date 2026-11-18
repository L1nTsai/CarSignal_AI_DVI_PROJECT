/**
 * Request bodies for the editor's mutation routes. Pure (zod only); the client
 * can import these types too.
 */
import { z } from "zod";
import { annotationsSchema } from "../annotations";
import { carZoneSchema } from "../carZones";
import { LINE_RATINGS, type LineRating } from "../types/db";

const rating = z.enum(LINE_RATINGS as [LineRating, ...LineRating[]]);
const ms = z.number().int().nonnegative();
const uuid = z.uuid();

/** "" or whitespace -> null, so a field can be cleared. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => (s.trim() === "" ? null : s.trim()))
    .nullable();

export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Uppercase and drop spaces; validation happens separately. */
export function normalizeVin(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

/** Message for the tech, or null when valid (an empty VIN is allowed until Send). */
export function vinError(vin: string): string | null {
  if (vin === "") return null;
  if (vin.length !== 17) return `A VIN has 17 characters (this has ${vin.length}).`;
  if (/[IOQ]/.test(vin)) return "A VIN never contains the letters I, O or Q.";
  if (!VIN_RE.test(vin)) return "Use only letters and numbers.";
  return null;
}

export const inspectionPatchSchema = z
  .object({
    customer_name: optionalText(200),
    vehicle_year: z.number().int().min(1900).max(2100).nullable(),
    vehicle_make: optionalText(100),
    vehicle_model: optionalText(100),
    vin: z
      .string()
      .transform(normalizeVin)
      .refine((v) => v === "" || VIN_RE.test(v), {
        message: "VIN must be 17 letters or numbers, without I, O or Q",
      })
      .transform((v) => (v === "" ? null : v))
      .nullable(),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "Nothing to update" });
export type InspectionPatch = z.input<typeof inspectionPatchSchema>;

const componentName = z.string().trim().min(1, "Name can't be empty").max(200);
const note = z.string().max(4000);

export const rangeSchema = z
  .object({ start_ms: ms, end_ms: ms })
  .refine((r) => r.end_ms > r.start_ms, { message: "The end must be after the start" })
  .refine((r) => r.end_ms - r.start_ms <= 60_000, { message: "A clip can be at most 60 seconds long" });

export const lineCreateSchema = z
  .object({
    component_name: componentName,
    rating,
    note: note.default(""),
    /** Where on the car. Left out: guessed from the name; null: not on the car. */
    car_zone: carZoneSchema.nullable().optional(),
    /** Optional first clip; a line needs one before Send. */
    clip: rangeSchema.optional(),
  })
  .strict();
export type LineCreate = z.input<typeof lineCreateSchema>;

export const linePatchSchema = z
  .object({ component_name: componentName, note, rating, car_zone: carZoneSchema.nullable() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "Nothing to update" });
export type LinePatch = z.input<typeof linePatchSchema>;

export const reorderSchema = z
  .object({ ids: z.array(uuid).min(1) })
  .strict()
  .refine((o) => new Set(o.ids).size === o.ids.length, { message: "Duplicate ids" });

export const clipCreateSchema = rangeSchema;

/**
 * One of: a new range (queues a re-cut), a thumbnail pick, or the clip's whole
 * list of drawings (replaces it; no re-cut).
 */
export const clipPatchSchema = z.union([
  z.object({ start_ms: ms, end_ms: ms }).strict().pipe(rangeSchema),
  z.object({ thumbnail_frame_id: uuid }).strict(),
  z.object({ annotations: annotationsSchema }).strict(),
]);
export type ClipPatch = z.input<typeof clipPatchSchema>;

export const frameCreateSchema = z.object({ timestamp_ms: ms }).strict();
