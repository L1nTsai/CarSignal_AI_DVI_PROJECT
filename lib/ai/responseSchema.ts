/**
 * Gemini responseSchema (plan §8). Mirrors `rawAnalysisSchema` in ./types.ts;
 * responseSchema.test.ts keeps the two in sync.
 */
import { Type, type Schema } from "@google/genai";
import { CAR_ZONE_KEYS } from "../carZones";

export const RATINGS = ["good", "monitor", "needs_attention"] as const;
export const RATING_BASES = ["stated", "inferred"] as const;
/** Zones on the customer's car diagram, plus "none" for no single spot. */
export const CAR_ZONE_CHOICES = [...CAR_ZONE_KEYS, "none"] as const;

export const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    transcript: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          start_s: { type: Type.NUMBER },
          end_s: { type: Type.NUMBER },
        },
        required: ["text", "start_s", "end_s"],
        propertyOrdering: ["start_s", "end_s", "text"],
      },
    },
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          component_name: { type: Type.STRING },
          rating: { type: Type.STRING, enum: [...RATINGS] },
          rating_basis: { type: Type.STRING, enum: [...RATING_BASES] },
          note: { type: Type.STRING },
          car_zone: { type: Type.STRING, enum: [...CAR_ZONE_CHOICES] },
          mentions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                quote: { type: Type.STRING },
                visible_start_s: { type: Type.NUMBER },
                visible_end_s: { type: Type.NUMBER },
                best_frame_s: { type: Type.NUMBER },
              },
              required: ["quote", "visible_start_s", "visible_end_s", "best_frame_s"],
              propertyOrdering: ["quote", "visible_start_s", "visible_end_s", "best_frame_s"],
            },
          },
        },
        required: ["component_name", "rating", "rating_basis", "note", "car_zone", "mentions"],
        propertyOrdering: ["component_name", "mentions", "rating", "rating_basis", "note", "car_zone"],
      },
    },
  },
  required: ["transcript", "lines"],
  propertyOrdering: ["transcript", "lines"],
};
