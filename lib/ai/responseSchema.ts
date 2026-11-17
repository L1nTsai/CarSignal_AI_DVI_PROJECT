/**
 * Gemini responseSchema (plan §8). Mirrors `rawAnalysisSchema` in ./types.ts;
 * responseSchema.test.ts keeps the two in sync.
 */
import { Type, type Schema } from "@google/genai";

export const RATINGS = ["good", "monitor", "needs_attention"] as const;
export const RATING_BASES = ["stated", "inferred"] as const;

export const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          component_name: { type: Type.STRING },
          rating: { type: Type.STRING, enum: [...RATINGS] },
          rating_basis: { type: Type.STRING, enum: [...RATING_BASES] },
          note: { type: Type.STRING },
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
        required: ["component_name", "rating", "rating_basis", "note", "mentions"],
        propertyOrdering: ["component_name", "mentions", "rating", "rating_basis", "note"],
      },
    },
  },
  required: ["lines"],
};
