/**
 * Contract between the AI module and the worker's process_inspection handler.
 *
 *   worker  ──AnalyzeInput──►  analyzeInspection()  ──ValidatedAnalysis──►  worker
 *
 * The AI module owns: the Gemini call (plan §8), parsing the raw response with
 * `rawAnalysisSchema`, and repairing it into a `ValidatedAnalysis`.
 * The worker owns: clip ranges (lib/clipRanges), saving rows, queuing cuts.
 *
 * Invariants a ValidatedAnalysis MUST satisfy (checked by
 * `validatedAnalysisSchema` + `assertValidatedAnalysis`):
 *  - at least one line; every line has at least one mention
 *  - all times are integer ms on the STITCHED timeline, within [0, duration_ms]
 *  - visible_end_ms > visible_start_ms
 *  - visible_start_ms <= best_frame_ms <= visible_end_ms
 *  - quotes are non-empty after trim; component_name non-empty after trim
 *  - mentions within a line are sorted by visible_start_ms
 *  - lines are sorted by their first mention's visible_start_ms, so the worker
 *    assigns position = index + 1
 *  - transcript segments (captions: everything said, verbatim) have
 *    end_ms > start_ms, are within [0, duration_ms], sorted by start_ms and
 *    don't overlap. May be empty (older responses, or a silent video).
 *
 * If nothing survives validation, the AI module throws a JobError (worker/errors.ts)
 * with userMessage "The AI didn't find any inspected components in this recording."
 */
import { z } from "zod";
import { carZoneSchema } from "../carZones";

// ── Input ────────────────────────────────────────────────────────────────────
export interface AnalyzeInput {
  /** Local path to stitched.mp4 (downloaded by the worker). */
  stitchedPath: string;
  duration_ms: number;
  /** Start of each recorded piece on the stitched timeline, ms. Always starts with 0. */
  segment_starts_ms: number[];
}

export type AnalyzeFn = (input: AnalyzeInput) => Promise<ValidatedAnalysis>;

// ── Raw Gemini response (seconds, untrusted) ─────────────────────────────────
const rating = z.enum(["good", "monitor", "needs_attention"]);
const ratingBasis = z.enum(["stated", "inferred"]);

export const rawTranscriptSegmentSchema = z.object({
  text: z.string(),
  start_s: z.number(),
  end_s: z.number(),
});

export const rawAnalysisSchema = z.object({
  /** Optional so a response without it still yields lines. */
  transcript: z.array(rawTranscriptSegmentSchema).optional(),
  lines: z.array(
    z.object({
      component_name: z.string(),
      rating,
      rating_basis: ratingBasis,
      note: z.string(),
      /** A zone key or "none". Untrusted: anything else becomes null (validate.ts). Optional so older responses parse. */
      car_zone: z.unknown().optional(),
      mentions: z.array(
        z.object({
          quote: z.string(),
          visible_start_s: z.number(),
          visible_end_s: z.number(),
          best_frame_s: z.number(),
        }),
      ),
    }),
  ),
});
export type RawAnalysis = z.infer<typeof rawAnalysisSchema>;

// ── Validated output (ms, repaired, ordered) ─────────────────────────────────
const ms = z.number().int().nonnegative();

export const validatedMentionSchema = z
  .object({
    quote: z.string().refine((s) => s.trim() !== "", "empty quote"),
    visible_start_ms: ms,
    visible_end_ms: ms,
    best_frame_ms: ms,
  })
  .refine((m) => m.visible_end_ms > m.visible_start_ms, "visible_end_ms must be > visible_start_ms")
  .refine(
    (m) => m.best_frame_ms >= m.visible_start_ms && m.best_frame_ms <= m.visible_end_ms,
    "best_frame_ms must be inside the visible span",
  );

export const validatedLineSchema = z.object({
  component_name: z.string().refine((s) => s.trim() !== "", "empty component_name"),
  rating,
  rating_basis: ratingBasis,
  note: z.string(),
  /** Where on the car (lib/carZones.ts); null = no single spot. */
  car_zone: carZoneSchema.nullable().default(null),
  mentions: z.array(validatedMentionSchema).min(1),
});

export const transcriptSegmentSchema = z
  .object({
    text: z.string().refine((s) => s.trim() !== "", "empty transcript text"),
    start_ms: ms,
    end_ms: ms,
  })
  .refine((t) => t.end_ms > t.start_ms, "end_ms must be > start_ms");

export const validatedAnalysisSchema = z.object({
  /** Model id actually used (stored in ai_suggestions.model). */
  model: z.string().min(1),
  lines: z.array(validatedLineSchema).min(1),
  /** Everything the technician said, as timed caption segments. */
  transcript: z.array(transcriptSegmentSchema).default([]),
  /** Lines dropped during repair, for logging only. */
  dropped: z.array(z.object({ component_name: z.string(), reason: z.string() })),
});

export type ValidatedMention = z.infer<typeof validatedMentionSchema>;
export type ValidatedLine = z.infer<typeof validatedLineSchema>;
export type ValidatedAnalysis = z.infer<typeof validatedAnalysisSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

/** Throws if `a` breaks any invariant above (including ordering and duration bounds). */
export function assertValidatedAnalysis(a: unknown, duration_ms: number): ValidatedAnalysis {
  const v = validatedAnalysisSchema.parse(a);
  let prevFirst = -1;
  for (const line of v.lines) {
    let prev = -1;
    for (const m of line.mentions) {
      if (m.visible_end_ms > duration_ms) throw new Error(`mention past end of video in "${line.component_name}"`);
      if (m.visible_start_ms < prev) throw new Error(`mentions not sorted in "${line.component_name}"`);
      prev = m.visible_start_ms;
    }
    const first = line.mentions[0].visible_start_ms;
    if (first < prevFirst) throw new Error("lines not sorted by first mention");
    prevFirst = first;
  }
  let prevEnd = 0;
  for (const t of v.transcript) {
    if (t.end_ms > duration_ms) throw new Error("transcript segment past end of video");
    if (t.start_ms < prevEnd) throw new Error("transcript segments overlap or are not sorted");
    prevEnd = t.end_ms;
  }
  return v;
}
