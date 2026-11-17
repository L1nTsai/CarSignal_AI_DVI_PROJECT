/**
 * End-to-end check of the video worker against the local Supabase + ffmpeg.
 *
 *   npx tsx --env-file=.env.local worker/scripts/e2e.ts [--cleanup] [--out DIR] [video ...]
 *
 * Each video given becomes one recorded piece (in order), as if the tech paused
 * between them. With no videos, it generates four synthetic pieces that cover
 * the hard cases: landscape, portrait via rotation metadata, WebM, and a piece
 * with no audio track. Synthetic pieces blur every other half second so the
 * sharpness ranking has something to choose between.
 *
 * The AI step is replaced by a stub that puts one mention in each piece, a
 * second mention of line 1 in the last piece, and one mention straddling the
 * first pause point.
 *
 * It runs the real handlers (process_inspection -> cut_clip x N), then a re-cut
 * with a changed range and an extract_frame, checks the results, and copies the
 * stitched video, clips and thumbnails into --out for eyeballing.
 *
 * Don't run `npm run worker` at the same time for this inspection's jobs — the
 * script claims them itself (it's safe, but the worker would use the real,
 * not-yet-wired AI step and fail the inspection).
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AnalyzeFn, ValidatedAnalysis } from "@/lib/ai/types";
import { sql, withActor, db } from "@/lib/db";
import { env } from "@/lib/env";
import { storagePaths } from "@/lib/paths";
import { downloadToFile, removePrefix, uploadFile } from "@/lib/storage";
import type { ClipRow, FrameRow, InspectionRow, JobRow, VideoSegmentRow } from "@/lib/types/db";
import { cutClip } from "../handlers/cutClip";
import { extractFrame } from "../handlers/extractFrame";
import { makeProcessInspection } from "../handlers/processInspection";
import { ffmpeg, probeDisplaySize, probeDurationMs, run } from "../lib/ffmpeg";
import { hasAudio } from "../lib/video";
import type { JobHandler } from "../types";

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cleanup = args.includes("--cleanup");
const outIdx = args.indexOf("--out");
const outArg = outIdx >= 0 ? args[outIdx + 1] : undefined;
const inputs = args.filter((a, i) => !a.startsWith("--") && !(outIdx >= 0 && i === outIdx + 1));

let failures = 0;
const ok = (cond: boolean, msg: string, extra?: unknown) => {
  if (!cond) failures++;
  console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}${extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
};
const log = (msg: string) => console.log(`\n[e2e] ${msg}`);

// ── synthetic pieces ─────────────────────────────────────────────────────────
async function synth(dir: string): Promise<{ file: string; mime: string }[]> {
  // Blur during the first half of every second: frames at whole seconds are soft,
  // frames at x.5 s are sharp.
  const blur = "boxblur=10:enable='lt(mod(t,1),0.5)'";
  const src = (size: string, secs: number) => ["-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30:duration=${secs}`];
  const tone = (secs: number, f: number) => ["-f", "lavfi", "-i", `sine=frequency=${f}:sample_rate=48000:duration=${secs}`];
  const h264 = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];

  const p1 = path.join(dir, "p1_landscape.mp4");
  await ffmpeg([...src("1280x720", 12), ...tone(12, 440), "-vf", blur, ...h264, "-c:a", "aac", "-shortest", p1]);

  // Encoded landscape, flagged as rotated 90°: displays as 720x1280 portrait.
  const raw2 = path.join(dir, "p2_raw.mp4");
  const p2 = path.join(dir, "p2_rotated_portrait.mp4");
  await ffmpeg([...src("1280x720", 10), ...tone(10, 550), "-vf", blur, ...h264, "-c:a", "aac", "-shortest", raw2]);
  await ffmpeg(["-display_rotation", "90", "-i", raw2, "-c", "copy", p2]);

  const p3 = path.join(dir, "p3.webm");
  await ffmpeg([...src("640x480", 8), ...tone(8, 660), "-vf", blur, "-c:v", "libvpx-vp9", "-deadline", "realtime",
    "-b:v", "1M", "-c:a", "libopus", "-shortest", p3]);

  const p4 = path.join(dir, "p4_noaudio.mp4");
  await ffmpeg([...src("720x1280", 9), "-vf", blur, ...h264, "-an", p4]);

  return [
    { file: p1, mime: "video/mp4" },
    { file: p2, mime: "video/mp4" },
    { file: p3, mime: "video/webm" },
    { file: p4, mime: "video/mp4" },
  ];
}

// ── stub AI ──────────────────────────────────────────────────────────────────
const stubAnalyze: AnalyzeFn = async ({ duration_ms, segment_starts_ms }) => {
  const ends = [...segment_starts_ms.slice(1), duration_ms];
  const lines: ValidatedAnalysis["lines"] = segment_starts_ms.map((s, i) => {
    const len = ends[i] - s;
    const vs = s + Math.min(1000, Math.floor(len / 4));
    const ve = Math.min(ends[i], vs + Math.min(3000, Math.floor(len / 2)));
    return {
      component_name: `Part ${i + 1} Component`,
      rating: (["good", "monitor", "needs_attention"] as const)[i % 3],
      rating_basis: "stated",
      note: `Synthetic note for part ${i + 1}.`,
      mentions: [{ quote: `quote ${i + 1}`, visible_start_ms: vs, visible_end_ms: ve, best_frame_ms: Math.round((vs + ve) / 2 / 1000) * 1000 }],
    };
  });
  for (const l of lines) {
    const m = l.mentions[0];
    m.best_frame_ms = Math.min(m.visible_end_ms, Math.max(m.visible_start_ms, m.best_frame_ms));
  }
  if (segment_starts_ms.length > 1) {
    // Line 1 mentioned again at the end of the video.
    const ve = duration_ms - 200;
    lines[0].mentions.push({ quote: "quote 1 again", visible_start_ms: ve - 1500, visible_end_ms: ve, best_frame_ms: ve - 700 });
    // A mention whose visible span straddles the first pause point (best frame after it).
    const p = segment_starts_ms[1];
    lines.push({
      component_name: "Straddling Component",
      rating: "monitor",
      rating_basis: "inferred",
      note: "Straddles a pause point.",
      mentions: [{ quote: "straddle", visible_start_ms: p - 1500, visible_end_ms: p + 1500, best_frame_ms: p + 500 }],
    });
    lines.sort((a, b) => a.mentions[0].visible_start_ms - b.mentions[0].visible_start_ms);
  }
  return { model: "e2e-stub", lines, dropped: [] };
};

// ── job driving (claims only this inspection's jobs) ─────────────────────────
async function drain(inspectionId: string, handlers: Record<string, JobHandler>, workDir: string) {
  for (;;) {
    const [job] = await sql<JobRow[]>`
      update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
      where id = (select id from jobs where inspection_id = ${inspectionId} and status = 'queued'
                  order by id limit 1 for update skip locked)
      returning *`;
    if (!job) return;
    const tmp = await mkdtemp(path.join(workDir, `job-${job.id}-`));
    const t0 = Date.now();
    try {
      await handlers[job.kind].run(job, { tmpDir: tmp, log: (m, x) => console.log(`    [${job.kind} ${job.id}] ${m}`, x ? JSON.stringify(x) : "") });
      await sql`update jobs set status = 'succeeded', locked_at = null where id = ${job.id}`;
      console.log(`    ${job.kind} ${job.id} ok in ${Date.now() - t0} ms`);
    } catch (e) {
      await sql`update jobs set status = 'failed', locked_at = null, last_error = ${String(e)} where id = ${job.id}`;
      await handlers[job.kind].onFinalFailure?.(job, e);
      ok(false, `${job.kind} ${job.id} threw`, String(e));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}

async function decodesCleanly(file: string): Promise<string> {
  const { stderr } = await run("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
  return stderr.trim();
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const work = await mkdtemp(path.join(tmpdir(), "carsignal-e2e-"));
  const pieces = inputs.length
    ? inputs.map((f) => ({ file: path.resolve(f), mime: f.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4" }))
    : (log("generating synthetic pieces"), await synth(work));

  log("inputs");
  for (const p of pieces) {
    const size = await probeDisplaySize(p.file);
    console.log(`  ${path.basename(p.file)}  ${size.width}x${size.height}  audio=${await hasAudio(p.file)}`);
  }

  const [insp] = await sql<{ id: string }[]>`
    insert into inspections (status, processing_step) values ('processing', 'converting') returning id`;
  const id = insp.id;
  const out = outArg ? path.resolve(outArg) : path.join(work, "out");
  await mkdir(out, { recursive: true });
  log(`inspection ${id}`);

  for (let i = 0; i < pieces.length; i++) {
    const key = storagePaths.segment(id, i + 1, pieces[i].mime);
    await uploadFile(key, pieces[i].file, pieces[i].mime);
    await sql`insert into video_segments (inspection_id, segment_number, status, original_path, mime_type)
              values (${id}, ${i + 1}, 'uploaded', ${key}, ${pieces[i].mime})`;
  }
  await sql`insert into jobs (inspection_id, kind) values (${id}, 'process_inspection')`;

  const handlers = { process_inspection: makeProcessInspection(stubAnalyze), cut_clip: cutClip, extract_frame: extractFrame };
  log("running process_inspection + cut_clip jobs");
  const t0 = Date.now();
  await drain(id, handlers, work);
  console.log(`  total ${Date.now() - t0} ms`);

  // ── checks: stitch ─────────────────────────────────────────────────────────
  log("checking stitched video");
  const [row] = await sql<InspectionRow[]>`select * from inspections where id = ${id}`;
  ok(row.status === "ready_for_review", "inspection reached ready_for_review", { status: row.status, step: row.processing_step, reason: row.failure_reason });
  const segs = await sql<VideoSegmentRow[]>`select * from video_segments where inspection_id = ${id} order by segment_number`;
  let acc = 0;
  for (const s of segs) {
    ok(s.offset_ms === acc, `segment ${s.segment_number} offset ${s.offset_ms} = sum of earlier durations ${acc}`);
    acc += s.duration_ms ?? 0;
  }
  ok(Math.abs(acc - (row.duration_ms ?? 0)) <= 100, "stitched duration ≈ sum of pieces", { sum: acc, stitched: row.duration_ms });

  const stitched = path.join(out, "stitched.mp4");
  await downloadToFile(row.video_path!, stitched);
  const firstSize = await probeDisplaySize(pieces[0].file);
  const size = await probeDisplaySize(stitched);
  const expectPortrait = firstSize.height > firstSize.width;
  ok(expectPortrait ? size.width === 720 && size.height === 1280 : size.width === 1280 && size.height === 720,
    "stitched size follows the first piece's orientation", size);
  ok(await hasAudio(stitched), "stitched has audio");
  const errs = await decodesCleanly(stitched);
  ok(errs === "", "stitched decodes without errors", errs.slice(0, 300) || undefined);
  for (const s of segs.slice(1)) {
    for (const dt of [-150, 150]) {
      const f = path.join(work, `pause_${s.segment_number}_${dt}.jpg`);
      await ffmpeg(["-ss", ((s.offset_ms! + dt) / 1000).toFixed(3), "-i", stitched, "-frames:v", "1", f]);
      ok(true, `frame decodes ${dt} ms around pause point ${s.offset_ms}`);
    }
  }

  // ── checks: clips + frames ─────────────────────────────────────────────────
  log("checking clips");
  const clips = await sql<(ClipRow & { component_name: string })[]>`
    select c.*, li.component_name from clips c join line_items li on li.id = c.line_item_id
    where c.inspection_id = ${id} order by li.position, c.position`;
  const pauses = segs.slice(1).map((s) => s.offset_ms!);
  for (const c of clips) {
    const label = `${c.component_name} #${c.position} [${c.start_ms}-${c.end_ms}]`;
    ok(c.status === "ready" && !!c.path && c.cut_count === 1, `${label} ready`, { status: c.status, path: c.path });
    ok(!pauses.some((p) => p > c.start_ms && p < c.end_ms), `${label} doesn't cross a pause point`);
    if (!c.path) continue;
    const local = path.join(out, `clip_${c.position}_${c.component_name.replace(/\W+/g, "_")}.mp4`);
    await downloadToFile(c.path, local);
    const d = await probeDurationMs(local);
    ok(Math.abs(d - (c.end_ms - c.start_ms)) <= 150, `${label} duration ${d} ms ≈ range`);
    ok((await decodesCleanly(local)) === "", `${label} decodes cleanly`);

    const frames = await sql<FrameRow[]>`select * from frames where clip_id = ${c.id} order by timestamp_ms`;
    ok(frames.length >= 3 && frames.every((f) => f.timestamp_ms >= c.start_ms && f.timestamp_ms < c.end_ms),
      `${label} has ${frames.length} candidate frames inside the clip`);
    const thumb = frames.find((f) => f.id === c.thumbnail_frame_id);
    const maxSharp = Math.max(...frames.map((f) => f.sharpness));
    ok(!!thumb && thumb.sharpness === maxSharp, `${label} thumbnail is the sharpest`,
      frames.map((f) => `${f.timestamp_ms}:${f.sharpness.toFixed(0)}${f.id === c.thumbnail_frame_id ? "*" : ""}`));
    if (thumb) await downloadToFile(thumb.storage_path, local.replace(/\.mp4$/, "_thumb.jpg"));
  }

  // ── re-cut with a changed range ────────────────────────────────────────────
  const target = clips[0];
  if (target) {
    log("re-cut with a new range (tech edit)");
    const newStart = target.start_ms + 500;
    const newEnd = Math.min(target.end_ms + 1500, row.duration_ms!);
    await withActor("tech", async (tx) => {
      await tx`update clips set start_ms = ${newStart}, end_ms = ${newEnd}, status = 'pending' where id = ${target.id}`;
      await tx`insert into jobs (inspection_id, clip_id, kind) values (${id}, ${target.id}, 'cut_clip')`;
    });
    await drain(id, handlers, work);
    const [c] = await sql<ClipRow[]>`select * from clips where id = ${target.id}`;
    ok(c.status === "ready" && c.cut_count === 2 && c.path === storagePaths.clip(id, c.id, 2), "re-cut stored as cut 2", { path: c.path });
    const local = path.join(out, "recut.mp4");
    await downloadToFile(c.path!, local);
    ok(Math.abs((await probeDurationMs(local)) - (newEnd - newStart)) <= 150, "re-cut duration matches the new range");
    ok(c.path !== target.path, "old cut path left untouched");

    log("extract_frame (Use current frame)");
    const t = Math.round((newStart + newEnd) / 2);
    await sql`insert into jobs (inspection_id, clip_id, kind, frame_timestamp_ms) values (${id}, ${c.id}, 'extract_frame', ${t})`;
    await drain(id, handlers, work);
    const [after] = await sql<(ClipRow & { origin: string; ts: number })[]>`
      select c.*, f.origin, f.timestamp_ms as ts from clips c join frames f on f.id = c.thumbnail_frame_id where c.id = ${c.id}`;
    ok(after?.origin === "tech_picked" && after.ts === t, "thumbnail is the tech-picked frame", { origin: after?.origin, ts: after?.ts });
  }

  log(`outputs in ${out}`);
  console.log(`  editor: ${env().PUBLIC_BASE_URL}/inspections/${id}`);
  if (cleanup) {
    await sql`delete from inspections where id = ${id}`;
    await removePrefix(id);
    console.log("  cleaned up inspection + storage");
  }
  log(failures ? `${failures} check(s) FAILED` : "all checks passed");
  await db().end({ timeout: 5 });
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db().end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
