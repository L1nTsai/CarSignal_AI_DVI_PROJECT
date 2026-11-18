/**
 * process_inspection (plan §7): converting -> analyzing -> saving -> cutting.
 *
 *  1. converting (skipped when inspection.video_path is set, i.e. a re-process
 *     or a retry after the stitch succeeded): download segments, normalize each
 *     to one format, concat -> stitched.mp4, upload, save durations/offsets.
 *  2. analyzing: `analyze` (Gemini, lib/ai/analyze.ts), then
 *     assertValidatedAnalysis() and the grounding check. Grounding warnings
 *     aren't stored (the editor derives them), so here they're only logged.
 *  3. saving: one 'ai' transaction — replace lines, insert ai_suggestions /
 *     mentions / pending clips (ranges from lib/clips), step 'cutting', queue
 *     one cut_clip job per clip.
 */
import path from "node:path";
import { unsupportedNumbers } from "@/lib/ai/grounding";
import { assertValidatedAnalysis, type AnalyzeFn, type ValidatedAnalysis } from "@/lib/ai/types";
import { guessZone } from "@/lib/carZones";
import { computeClipRanges, type ClipRangeSettings, type RangeMention } from "@/lib/clips";
import { sql, withActor } from "@/lib/db";
import { env } from "@/lib/env";
import { storagePaths, segmentExt } from "@/lib/paths";
import { downloadToFile, removeObjects, uploadFile } from "@/lib/storage";
import type { InspectionRow, VideoSegmentRow } from "@/lib/types/db";
import { JobError } from "../errors";
import { analyze as defaultAnalyze } from "../lib/analyze";
import { markInspectionFailed, setProcessingStep } from "../lib/inspection";
import { getStitched, putStitched } from "../lib/stitchedCache";
import { chooseFrameSize, concatPieces, normalizePiece, probeDurationMs } from "../lib/video";
import type { JobContext, JobHandler } from "../types";

/** inspections.duration_ms check constraint. */
const MAX_DURATION_MS = 600_000;

export function clipRangeSettings(): ClipRangeSettings {
  const e = env();
  return { padBeforeMs: e.CLIP_PAD_BEFORE_MS, padAfterMs: e.CLIP_PAD_AFTER_MS, maxMs: e.MAX_AUTO_CLIP_MS };
}

interface Stitched {
  localPath: string;
  duration_ms: number;
  segment_starts_ms: number[];
}

/** Step 1: segments -> normalized pieces -> stitched.mp4 (uploaded + saved). */
async function convert(inspectionId: string, ctx: JobContext): Promise<Stitched> {
  await setProcessingStep(inspectionId, "converting");
  const segments = await sql<VideoSegmentRow[]>`
    select * from video_segments where inspection_id = ${inspectionId} order by segment_number`;
  if (segments.length === 0) {
    throw new JobError("no segments", { retryable: false, userMessage: "This inspection has no recorded video." });
  }
  const notUploaded = segments.find((s) => s.status !== "uploaded");
  if (notUploaded) {
    throw new JobError(`segment ${notUploaded.segment_number} is ${notUploaded.status}`, {
      retryable: false,
      userMessage: "Some parts of the recording didn't finish uploading. Record the inspection again.",
    });
  }

  const originals: string[] = [];
  for (const s of segments) {
    const file = path.join(ctx.tmpDir, `segment_${s.segment_number}.${segmentExt(s.mime_type)}`);
    await downloadToFile(s.original_path, file);
    originals.push(file);
  }

  const size = await chooseFrameSize(originals[0]).catch((e) => {
    throw unreadable(1, e);
  });
  ctx.log("normalizing", { pieces: segments.length, ...size });

  const pieces: string[] = [];
  const durations: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const out = path.join(ctx.tmpDir, `piece_${i + 1}.mp4`);
    try {
      await normalizePiece(originals[i], out, size);
      // Probe the normalized piece, not the original: MediaRecorder WebM often
      // has no duration in its header, and these are the files actually joined.
      durations.push(await probeDurationMs(out));
    } catch (e) {
      throw unreadable(i + 1, e);
    }
    pieces.push(out);
  }

  const stitchedLocal = path.join(ctx.tmpDir, "stitched.mp4");
  await concatPieces(pieces, stitchedLocal, ctx.tmpDir);
  let duration_ms = await probeDurationMs(stitchedLocal);
  const offsets: number[] = [];
  let acc = 0;
  for (const d of durations) {
    offsets.push(acc);
    acc += d;
  }
  ctx.log("stitched", { duration_ms, sum_of_pieces_ms: acc, offsets });
  if (duration_ms > MAX_DURATION_MS) {
    // The recorder caps at 10 min; container rounding can push us a hair over.
    ctx.log("clamping duration to the 10-minute cap", { duration_ms });
    duration_ms = MAX_DURATION_MS;
  }

  // Not referenced by any row yet, so replacing a leftover from a crashed attempt is safe.
  const stitchedPath = storagePaths.stitched(inspectionId);
  await removeObjects([stitchedPath]);
  await uploadFile(stitchedPath, stitchedLocal, "video/mp4");

  await withActor("ai", async (tx) => {
    for (let i = 0; i < segments.length; i++) {
      await tx`update video_segments set duration_ms = ${durations[i]}, offset_ms = ${offsets[i]}
               where id = ${segments[i].id}`;
    }
    await tx`update inspections set video_path = ${stitchedPath}, duration_ms = ${duration_ms}
             where id = ${inspectionId}`;
  });

  const localPath = await putStitched(stitchedPath, stitchedLocal).catch(() => stitchedLocal);
  return { localPath, duration_ms, segment_starts_ms: offsets };
}

function unreadable(n: number, cause: unknown): JobError {
  const msg = cause instanceof Error ? cause.message : String(cause);
  return new JobError(`piece ${n} unreadable: ${msg}`, {
    retryable: false,
    userMessage: `Part ${n} of the recording couldn't be read. Record the inspection again.`,
  });
}

/** Re-process: reuse the stitched video and the saved pause points. */
async function existingStitched(insp: InspectionRow): Promise<Stitched> {
  const segs = await sql<{ offset_ms: number }[]>`
    select offset_ms from video_segments
    where inspection_id = ${insp.id} and offset_ms is not null order by segment_number`;
  return {
    localPath: await getStitched(insp.video_path!),
    duration_ms: insp.duration_ms!,
    segment_starts_ms: segs.length ? segs.map((s) => s.offset_ms) : [0],
  };
}

/** Step 3: replace lines with the AI result and queue the cuts. Returns the clip count, or null if the inspection stopped processing (cancelled) and nothing was saved. */
export async function saveResults(
  inspectionId: string,
  analysis: ValidatedAnalysis,
  timeline: { duration_ms: number; segment_starts_ms: number[] },
  settings: ClipRangeSettings = clipRangeSettings(),
): Promise<number | null> {
  const flat: RangeMention[] = analysis.lines.flatMap((line, li) => line.mentions.map((m) => ({ line: li, ...m })));
  const ranges = computeClipRanges(flat, timeline, settings);

  return withActor("ai", async (tx) => {
    const [insp] = await tx<{ status: string }[]>`
      select status from inspections where id = ${inspectionId} for update`;
    if (insp?.status !== "processing") return null;

    await tx`delete from line_items where inspection_id = ${inspectionId}`;

    await tx`delete from transcript_segments where inspection_id = ${inspectionId}`;
    if (analysis.transcript.length) {
      const rows = analysis.transcript.map((t) => ({ inspection_id: inspectionId, ...t }));
      await tx`insert into transcript_segments ${tx(rows, "inspection_id", "start_ms", "end_ms", "text")}`;
    }

    const clipIds: string[] = [];
    let k = 0;
    for (let li = 0; li < analysis.lines.length; li++) {
      const line = analysis.lines[li];
      // The AI's zone; if it gave none, a keyword guess from the name (the tech can change either).
      const zone = line.car_zone ?? guessZone(line.component_name);
      const [{ id: lineId }] = await tx<{ id: string }[]>`
        insert into line_items (inspection_id, position, component_name, note, rating, car_zone)
        values (${inspectionId}, ${li + 1}, ${line.component_name.trim()}, ${line.note.trim()}, ${line.rating}, ${zone})
        returning id`;
      await tx`
        insert into ai_suggestions (line_item_id, component_name, note, rating, rating_basis, model, car_zone)
        values (${lineId}, ${line.component_name.trim()}, ${line.note.trim()}, ${line.rating},
                ${line.rating_basis}, ${analysis.model}, ${line.car_zone})`;
      for (let mi = 0; mi < line.mentions.length; mi++, k++) {
        const m = line.mentions[mi];
        const [{ id: mentionId }] = await tx<{ id: string }[]>`
          insert into mentions (line_item_id, visible_start_ms, visible_end_ms, best_frame_ms, quote)
          values (${lineId}, ${m.visible_start_ms}, ${m.visible_end_ms}, ${m.best_frame_ms}, ${m.quote.trim()})
          returning id`;
        const r = ranges[k];
        const [{ id: clipId }] = await tx<{ id: string }[]>`
          insert into clips (inspection_id, line_item_id, mention_id, position, start_ms, end_ms, status)
          values (${inspectionId}, ${lineId}, ${mentionId}, ${mi + 1}, ${r.start_ms}, ${r.end_ms}, 'pending')
          returning id`;
        clipIds.push(clipId);
      }
    }

    // transcribed_at marks "transcript saved" even when it's empty (nothing was said).
    await tx`update inspections set processing_step = 'cutting', transcribed_at = now() where id = ${inspectionId}`;
    const jobs = clipIds.map((clip_id) => ({ inspection_id: inspectionId, clip_id, kind: "cut_clip" }));
    await tx`insert into jobs ${tx(jobs, "inspection_id", "clip_id", "kind")}`;
    return clipIds.length;
  });
}

export function makeProcessInspection(analyzeFn: AnalyzeFn = defaultAnalyze): JobHandler {
  return {
    async run(job, ctx) {
      const [insp] = await sql<InspectionRow[]>`select * from inspections where id = ${job.inspection_id}`;
      if (!insp || insp.status !== "processing") {
        ctx.log("inspection is not processing; nothing to do", { status: insp?.status ?? "missing" });
        return;
      }

      const stitched = insp.video_path ? await existingStitched(insp) : await convert(insp.id, ctx);

      // Cancelled while converting? Don't spend a Gemini call. (Cancel is final;
      // the inspection can only be deleted now.)
      const [now] = await sql<{ status: string }[]>`select status from inspections where id = ${insp.id}`;
      if (now?.status !== "processing") {
        ctx.log("inspection no longer processing (cancelled?); skipping the AI step", { status: now?.status ?? "missing" });
        return;
      }

      await setProcessingStep(insp.id, "analyzing");
      const raw = await analyzeFn({
        stitchedPath: stitched.localPath,
        duration_ms: stitched.duration_ms,
        segment_starts_ms: stitched.segment_starts_ms,
      });
      const analysis = assertValidatedAnalysis(raw, stitched.duration_ms);
      if (analysis.dropped.length) ctx.log("AI lines dropped during repair", { dropped: analysis.dropped });
      const ungrounded = analysis.lines
        .map((l) => ({ line: l.component_name, numbers: unsupportedNumbers(l.note, l.mentions.map((m) => m.quote)) }))
        .filter((g) => g.numbers.length > 0);
      if (ungrounded.length) ctx.log("AI notes mention numbers the tech didn't say", { ungrounded });

      const clips = await saveResults(insp.id, analysis, stitched);
      if (clips === null) {
        ctx.log("inspection no longer processing (cancelled?); AI result discarded", { lines: analysis.lines.length });
        return;
      }
      ctx.log("saved AI results", { lines: analysis.lines.length, clips, model: analysis.model });
    },

    async onFinalFailure(job, error) {
      const reason =
        error instanceof JobError && error.userMessage
          ? error.userMessage
          : "Processing failed. Try again, or record the inspection again.";
      await markInspectionFailed(job.inspection_id, reason);
    },
  };
}

export const processInspection = makeProcessInspection();
