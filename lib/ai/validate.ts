/**
 * Validate and repair Gemini output (plan §8). Pure — no SDK, no env, no I/O.
 *
 *   raw JSON (seconds, untrusted) ──repairAnalysis──► ValidatedAnalysis (ms, clamped, ordered)
 *
 * Lenient by design: one malformed line or mention is dropped rather than failing
 * the whole inspection. Only a response with no usable `lines` array is an error.
 */
import { z } from "zod";
import { isCarZone, type CarZone } from "../carZones";
import {
  rawAnalysisSchema,
  rawTranscriptSegmentSchema,
  validatedAnalysisSchema,
  type TranscriptSegment,
  type ValidatedAnalysis,
  type ValidatedLine,
  type ValidatedMention,
} from "./types";

export const MIN_SPAN_MS = 1000;

export type DroppedLine = ValidatedAnalysis["dropped"][number];

export type RepairResult =
  | { ok: true; analysis: ValidatedAnalysis }
  | {
      ok: false;
      /** invalid_response: unusable JSON shape (worth retrying). no_lines: nothing survived repair. */
      error: "invalid_response" | "no_lines";
      message: string;
      dropped: DroppedLine[];
    };

export interface RepairOptions {
  duration_ms: number;
  model: string;
}

const rawLineSchema = rawAnalysisSchema.shape.lines.element;
const rawMentionSchema = rawLineSchema.shape.mentions.element;
// Parse mentions one by one so a single bad mention doesn't sink its line.
const looseLineSchema = rawLineSchema.extend({ mentions: z.array(z.unknown()) });
const looseTopSchema = z.object({ lines: z.array(z.unknown()), transcript: z.array(z.unknown()).optional() });

/**
 * Lenient transcript repair: drop unusable segments, clamp to the video,
 * sort, and trim overlaps (an earlier segment ends where the next begins).
 * Exported for tests.
 */
export function repairTranscript(raw: unknown[] | undefined, duration_ms: number): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const r of raw ?? []) {
    const p = rawTranscriptSegmentSchema.safeParse(r);
    if (!p.success) continue;
    const text = p.data.text.trim().replace(/\s+/g, " ");
    if (text === "" || !Number.isFinite(p.data.start_s) || !Number.isFinite(p.data.end_s)) continue;
    const start = clamp(Math.round(p.data.start_s * 1000), 0, duration_ms);
    let end = clamp(Math.round(p.data.end_s * 1000), 0, duration_ms);
    if (end <= start) end = Math.min(start + MIN_SPAN_MS, duration_ms);
    if (end <= start) continue;
    out.push({ text, start_ms: start, end_ms: end });
  }
  out.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  const fixed: TranscriptSegment[] = [];
  for (const t of out) {
    const prev = fixed.at(-1);
    if (prev && t.start_ms < prev.end_ms) {
      if (t.start_ms > prev.start_ms) prev.end_ms = t.start_ms;
      else continue; // same start as the previous one: keep the first
    }
    fixed.push(t);
  }
  return fixed;
}

/** Gemini sometimes returns "Needs Attention" or "needs attention" despite the enum. */
/** A zone key, or null for "none", missing or unknown. A bad zone never drops a line. */
export function normalizeZone(v: unknown): CarZone | null {
  const z = normalizeEnum(v);
  return isCarZone(z) ? z : null;
}

function normalizeEnum(v: unknown): unknown {
  return typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Seconds -> repaired ms span on [0, duration_ms]. Exported for tests. */
export function repairSpan(
  start_s: number,
  end_s: number,
  best_s: number,
  duration_ms: number,
): Pick<ValidatedMention, "visible_start_ms" | "visible_end_ms" | "best_frame_ms"> {
  let start = clamp(Math.round(start_s * 1000), 0, duration_ms);
  let end = clamp(Math.round(end_s * 1000), 0, duration_ms);
  if (end <= start) {
    end = Math.min(start + MIN_SPAN_MS, duration_ms);
    // Mention at the very end of the video: grow backwards instead.
    if (end <= start) start = Math.max(0, end - MIN_SPAN_MS);
  }
  const best = clamp(Math.round(best_s * 1000), start, end);
  return { visible_start_ms: start, visible_end_ms: end, best_frame_ms: best };
}

function firstIssue(e: z.ZodError): string {
  const i = e.issues[0];
  return i ? `${i.path.join(".") || "(root)"}: ${i.message}` : "invalid";
}

export function repairAnalysis(raw: unknown, opts: RepairOptions): RepairResult {
  const { duration_ms, model } = opts;
  if (!Number.isFinite(duration_ms) || duration_ms < MIN_SPAN_MS) {
    throw new Error(`repairAnalysis: duration_ms must be >= ${MIN_SPAN_MS}, got ${duration_ms}`);
  }

  const top = looseTopSchema.safeParse(raw);
  if (!top.success) {
    return { ok: false, error: "invalid_response", message: `Gemini response: ${firstIssue(top.error)}`, dropped: [] };
  }

  const dropped: DroppedLine[] = [];
  const lines: ValidatedLine[] = [];

  top.data.lines.forEach((rawLine, i) => {
    const fallbackName =
      rawLine && typeof rawLine === "object" && typeof (rawLine as { component_name?: unknown }).component_name === "string"
        ? (rawLine as { component_name: string }).component_name
        : `(line ${i + 1})`;

    const candidate =
      rawLine && typeof rawLine === "object"
        ? {
            ...rawLine,
            rating: normalizeEnum((rawLine as Record<string, unknown>).rating),
            rating_basis: normalizeEnum((rawLine as Record<string, unknown>).rating_basis),
          }
        : rawLine;
    const parsed = looseLineSchema.safeParse(candidate);
    if (!parsed.success) {
      dropped.push({ component_name: fallbackName, reason: `invalid line (${firstIssue(parsed.error)})` });
      return;
    }
    const line = parsed.data;

    const component_name = line.component_name.trim().replace(/\s+/g, " ");
    if (component_name === "") {
      dropped.push({ component_name: fallbackName, reason: "empty component_name" });
      return;
    }

    const mentions: ValidatedMention[] = [];
    for (const rm of line.mentions) {
      const m = rawMentionSchema.safeParse(rm);
      if (!m.success) continue; // non-numeric / missing times
      const quote = m.data.quote.trim();
      if (quote === "") continue;
      mentions.push({
        quote,
        ...repairSpan(m.data.visible_start_s, m.data.visible_end_s, m.data.best_frame_s, duration_ms),
      });
    }
    if (mentions.length === 0) {
      dropped.push({
        component_name,
        reason: line.mentions.length === 0 ? "no mentions" : "no usable mentions (empty quotes or bad times)",
      });
      return;
    }
    // Stable sort; ties broken by best frame.
    mentions.sort((a, b) => a.visible_start_ms - b.visible_start_ms || a.best_frame_ms - b.best_frame_ms);

    lines.push({
      component_name,
      rating: line.rating,
      rating_basis: line.rating_basis,
      note: line.note.trim(),
      car_zone: normalizeZone(line.car_zone),
      mentions,
    });
  });

  if (lines.length === 0) {
    return {
      ok: false,
      error: "no_lines",
      message: "No inspected components survived validation.",
      dropped,
    };
  }

  lines.sort((a, b) => a.mentions[0].visible_start_ms - b.mentions[0].visible_start_ms);

  // Belt and braces: the contract schema must accept what we built.
  const transcript = repairTranscript(top.data.transcript, duration_ms);
  const analysis = validatedAnalysisSchema.parse({ model, lines, transcript, dropped });
  return { ok: true, analysis };
}

/**
 * Parse model text into JSON. Tolerates a ```json fence, which models occasionally
 * add even in JSON mode. Returns undefined when it isn't JSON.
 */
export function parseModelJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}
