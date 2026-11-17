/**
 * npm run seed:demo — demo data so UI work doesn't wait for the real pipeline.
 *
 * Generates a test video with ffmpeg (2 recorded pieces: 20 s landscape, then
 * 16 s portrait, so players see an orientation switch), stitches it like the
 * worker will (plan §7), cuts clips and extracts frames, and creates one
 * inspection per status:
 *
 *   recording         2 uploaded pieces, nothing processed (laptop pairing view)
 *   processing        step 'cutting', some clips ready, some pending
 *   failed            with a failure_reason (Retry view)
 *   ready_for_review  5 AI lines, 6 clips; VIN missing (Send disabled);
 *                     one note has an unsupported number (grounding warning)
 *   sent              sent twice (v1, v2: one line updated, one removed, one
 *                     tech line added), plus an unsent tech edit after v2
 *
 * Each run adds new inspections. `npm run db:reset` clears everything
 * (and then remove storage files via Studio if you care).
 * Sharpness values are fake; the real scoring belongs to the worker.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, sql, withActor, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { storagePaths } from "@/lib/paths";
import { uploadFile } from "@/lib/storage";
import type { LineRating, RatingBasis } from "@/lib/types/db";
import { ffmpeg, probeDurationMs } from "@/worker/lib/ffmpeg";

const SEG1_MS = 20_000;
const SEG2_MS = 16_000;
const MODEL = "demo-seed";

interface DemoMention {
  quote: string;
  start: number;
  end: number;
  best: number;
}
interface DemoLine {
  name: string;
  rating: LineRating;
  basis: RatingBasis;
  note: string;
  mentions: DemoMention[];
}

// Times are on the stitched timeline (piece 2 starts at 20 000 ms).
const LINES: DemoLine[] = [
  {
    name: "Left Front Tire",
    rating: "needs_attention",
    basis: "stated",
    note: "The inner edge of the tire is worn.",
    mentions: [
      { quote: "Left front tire. The inner edge is worn. Mark it needs attention.", start: 1500, end: 6000, best: 4000 },
      { quote: "Back on the left front tire, the wear goes most of the way around.", start: 23000, end: 26500, best: 25000 },
    ],
  },
  {
    name: "Wipers",
    rating: "good",
    basis: "inferred",
    note: "The wipers look good.",
    mentions: [{ quote: "Wipers. These look good.", start: 7500, end: 10500, best: 9000 }],
  },
  {
    name: "Front Brake Pads",
    rating: "monitor",
    basis: "stated",
    note: "The front brake pads are at about 4 millimeters.",
    mentions: [
      { quote: "Front brake pads, they're at about 4 millimeters, put them on monitor.", start: 12000, end: 17500, best: 15000 },
    ],
  },
  {
    name: "Engine Air Filter",
    rating: "good",
    basis: "stated",
    // Deliberate grounding problem: "12,000 miles" was never said.
    note: "The engine air filter is clean. Replace it in 12,000 miles.",
    mentions: [{ quote: "Engine air filter is clean, mark it good.", start: 28000, end: 31500, best: 30000 }],
  },
  {
    name: "Right Headlight",
    rating: "monitor",
    basis: "inferred",
    note: "The right headlight lens is a little cloudy.",
    mentions: [{ quote: "Right headlight, the lens is a little cloudy.", start: 32500, end: 35500, best: 34000 }],
  },
];

const log = (msg: string) => console.log(`[seed:demo] ${msg}`);

// ── Media generation ─────────────────────────────────────────────────────────
async function makeVideo(dir: string) {
  const seg1 = path.join(dir, "seg1.mp4");
  const seg2 = path.join(dir, "seg2.mp4");
  const gen = (out: string, size: string, secs: number, freq: number) =>
    ffmpeg([
      "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30:duration=${secs}`,
      "-f", "lavfi", "-i", `sine=frequency=${freq}:sample_rate=48000:duration=${secs}`,
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", out,
    ]);
  await gen(seg1, "1280x720", SEG1_MS / 1000, 440);
  await gen(seg2, "720x1280", SEG2_MS / 1000, 660);

  // Normalize like the worker (first piece is landscape -> 1280x720), then concat.
  const norm = (i: string, o: string) =>
    ffmpeg([
      "-i", i,
      "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "48000", "-ac", "1", "-b:a", "96k", "-movflags", "+faststart", o,
    ]);
  const n1 = path.join(dir, "n1.mp4");
  const n2 = path.join(dir, "n2.mp4");
  await norm(seg1, n1);
  await norm(seg2, n2);
  const list = path.join(dir, "list.txt");
  await writeFile(list, `file '${n1}'\nfile '${n2}'\n`);
  const stitched = path.join(dir, "stitched.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", stitched]);

  const d1 = await probeDurationMs(n1);
  const d2 = await probeDurationMs(n2);
  const total = await probeDurationMs(stitched);
  return { seg1, seg2, stitched, d1, d2, total };
}

/** Simple demo clip range: ±3 s, kept inside the recorded piece. Not the real algorithm. */
function demoRange(m: DemoMention, pieceBoundary: number, total: number) {
  const [lo, hi] = m.best < pieceBoundary ? [0, pieceBoundary] : [pieceBoundary, total];
  return { start: Math.max(lo, m.start - 3000), end: Math.min(hi, m.end + 3000) };
}

const cutCache = new Map<string, { clip: string; frames: { t: number; file: string }[] }>();

async function cutAndFrames(dir: string, stitched: string, start: number, end: number, best: number | null) {
  const key = `${start}-${end}-${best}`;
  const hit = cutCache.get(key);
  if (hit) return hit;
  const clip = path.join(dir, `clip-${key}.mp4`);
  await ffmpeg([
    "-ss", (start / 1000).toFixed(3), "-i", stitched, "-t", ((end - start) / 1000).toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", clip,
  ]);
  const times =
    best !== null
      ? [-1000, -500, 0, 500, 1000].map((d) => Math.min(end - 100, Math.max(start, best + d)))
      : [0, 1, 2, 3, 4].map((i) => Math.round(start + ((end - start) * (i + 0.5)) / 5));
  const frames: { t: number; file: string }[] = [];
  for (const t of times) {
    const file = path.join(dir, `frame-${t}.jpg`);
    await ffmpeg(["-ss", (t / 1000).toFixed(3), "-i", stitched, "-frames:v", "1", "-q:v", "3", file]);
    frames.push({ t, file });
  }
  const out = { clip, frames };
  cutCache.set(key, out);
  return out;
}

// ── DB helpers ───────────────────────────────────────────────────────────────
interface Media {
  dir: string;
  seg1: string;
  seg2: string;
  stitched: string;
  d1: number;
  d2: number;
  total: number;
}

async function uploadSegments(tx: Tx, id: string, m: Media, processed: boolean) {
  const pieces = [
    { n: 1, file: m.seg1, dur: m.d1, off: 0 },
    { n: 2, file: m.seg2, dur: m.d2, off: m.d1 },
  ];
  for (const p of pieces) {
    const key = storagePaths.segment(id, p.n, "video/mp4");
    await uploadFile(key, p.file, "video/mp4");
    await tx`
      insert into video_segments (inspection_id, segment_number, status, original_path, mime_type, duration_ms, offset_ms)
      values (${id}, ${p.n}, 'uploaded', ${key}, 'video/mp4',
              ${processed ? p.dur : null}, ${processed ? p.off : null})`;
  }
}

/** Inserts a ready (or pending) clip with frames + thumbnail. */
async function insertClip(
  tx: Tx,
  m: Media,
  o: { inspectionId: string; lineId: string; mentionId: string | null; position: number; start: number; end: number; best: number | null; ready: boolean },
) {
  const [clip] = await tx<{ id: string }[]>`
    insert into clips (inspection_id, line_item_id, mention_id, position, start_ms, end_ms, status)
    values (${o.inspectionId}, ${o.lineId}, ${o.mentionId}, ${o.position}, ${o.start}, ${o.end}, 'pending')
    returning id`;
  if (!o.ready) return clip.id;

  const media = await cutAndFrames(m.dir, m.stitched, o.start, o.end, o.best);
  const clipPath = storagePaths.clip(o.inspectionId, clip.id, 1);
  await uploadFile(clipPath, media.clip, "video/mp4");

  const frameIds: string[] = [];
  for (const [i, f] of media.frames.entries()) {
    const frameId = randomUUID();
    const framePath = storagePaths.frame(o.inspectionId, frameId);
    await uploadFile(framePath, f.file, "image/jpeg");
    await tx`
      insert into frames (id, clip_id, timestamp_ms, storage_path, origin, sharpness)
      values (${frameId}, ${clip.id}, ${f.t}, ${framePath}, 'ai_candidate', ${50 + ((i * 37) % 40)})`;
    frameIds.push(frameId);
  }
  await tx`
    update clips set status = 'ready', path = ${clipPath}, cut_count = 1, thumbnail_frame_id = ${frameIds[2]}
    where id = ${clip.id}`;
  return clip.id;
}

async function insertAiLines(tx: Tx, id: string, m: Media, opts: { readyClips: number | "all" } = { readyClips: "all" }) {
  let clipIndex = 0;
  const lineIds: Record<string, string> = {};
  for (const [li, line] of LINES.entries()) {
    const [row] = await tx<{ id: string }[]>`
      insert into line_items (inspection_id, position, component_name, note, rating)
      values (${id}, ${li + 1}, ${line.name}, ${line.note}, ${line.rating}) returning id`;
    lineIds[line.name] = row.id;
    await tx`
      insert into ai_suggestions (line_item_id, component_name, note, rating, rating_basis, model)
      values (${row.id}, ${line.name}, ${line.note}, ${line.rating}, ${line.basis}, ${MODEL})`;
    for (const [mi, mention] of line.mentions.entries()) {
      const [mrow] = await tx<{ id: string }[]>`
        insert into mentions (line_item_id, visible_start_ms, visible_end_ms, best_frame_ms, quote)
        values (${row.id}, ${mention.start}, ${mention.end}, ${mention.best}, ${mention.quote}) returning id`;
      const r = demoRange(mention, m.d1, m.total);
      const ready = opts.readyClips === "all" || clipIndex < opts.readyClips;
      await insertClip(tx, m, {
        inspectionId: id, lineId: row.id, mentionId: mrow.id, position: mi + 1,
        start: r.start, end: r.end, best: mention.best, ready,
      });
      clipIndex++;
    }
  }
  return lineIds;
}

async function createInspection(tx: Tx, fields: Record<string, unknown>) {
  const [row] = await tx<{ id: string }[]>`insert into inspections ${tx(fields)} returning id`;
  return row.id;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "carsignal-seed-"));
  try {
    log("generating test video with ffmpeg…");
    const media: Media = { dir, ...(await makeVideo(dir)) };
    log(`stitched ${media.total} ms (pause point at ${media.d1} ms)`);
    const out: Record<string, string> = {};

    // recording
    out.recording = await withActor("ai", async (tx) => {
      const id = await createInspection(tx, { status: "recording" });
      await uploadSegments(tx, id, media, false);
      return id;
    });

    // processing (cutting, 3 of 6 clips ready)
    out.processing = await withActor("ai", async (tx) => {
      const id = await createInspection(tx, { status: "processing", processing_step: "cutting" });
      await uploadSegments(tx, id, media, true);
      const stitchedPath = storagePaths.stitched(id);
      await uploadFile(stitchedPath, media.stitched, "video/mp4");
      await tx`update inspections set video_path = ${stitchedPath}, duration_ms = ${media.total} where id = ${id}`;
      await insertAiLines(tx, id, media, { readyClips: 3 });
      return id;
    });

    // failed
    out.failed = await withActor("ai", async (tx) => {
      const id = await createInspection(tx, {
        status: "failed",
        failure_reason: "The AI didn't find any inspected components in this recording.",
      });
      await uploadSegments(tx, id, media, true);
      return id;
    });

    // ready_for_review
    out.ready_for_review = await withActor("ai", async (tx) => {
      const id = await createInspection(tx, {
        status: "processing", processing_step: "cutting",
        customer_name: "Dana Lopez", vehicle_year: 2019, vehicle_make: "Honda", vehicle_model: "Civic",
      });
      await uploadSegments(tx, id, media, true);
      const stitchedPath = storagePaths.stitched(id);
      await uploadFile(stitchedPath, media.stitched, "video/mp4");
      await insertAiLines(tx, id, media);
      await tx`
        update inspections
        set status = 'ready_for_review', processing_step = null, video_path = ${stitchedPath}, duration_ms = ${media.total}
        where id = ${id}`;
      return id;
    });

    // sent (v1, then tech edits, v2, then one unsent tech edit)
    const sentId = await withActor("ai", async (tx) => {
      const id = await createInspection(tx, {
        status: "processing", processing_step: "cutting",
        customer_name: "Sam Patel", vehicle_year: 2021, vehicle_make: "Toyota", vehicle_model: "RAV4",
        vin: "2T3P1RFV8MC123456",
      });
      await uploadSegments(tx, id, media, true);
      const stitchedPath = storagePaths.stitched(id);
      await uploadFile(stitchedPath, media.stitched, "video/mp4");
      await insertAiLines(tx, id, media);
      await tx`
        update inspections
        set status = 'ready_for_review', processing_step = null, video_path = ${stitchedPath}, duration_ms = ${media.total}
        where id = ${id}`;
      return id;
    });
    const [{ send_report: token }] = await sql<{ send_report: string }[]>`select send_report(${sentId})`;
    log("sent v1");

    await withActor("tech", async (tx) => {
      await tx`update line_items set rating = 'needs_attention', note = 'The front brake pads are at about 4 millimeters. Replace soon.'
               where inspection_id = ${sentId} and component_name = 'Front Brake Pads'`;
      await tx`delete from line_items where inspection_id = ${sentId} and component_name = 'Engine Air Filter'`;
      // positions must stay 1..n after the delete
      const ids = await tx<{ id: string }[]>`select id from line_items where inspection_id = ${sentId} order by position`;
      await tx`select reorder_lines(${sentId}, ${ids.map((r) => r.id)}::uuid[])`;
      const [line] = await tx<{ id: string }[]>`
        insert into line_items (inspection_id, position, component_name, note, rating)
        values (${sentId}, ${ids.length + 1}, 'Cabin Air Filter', 'The cabin air filter is dirty.', 'needs_attention')
        returning id`;
      await insertClip(tx, media, {
        inspectionId: sentId, lineId: line.id, mentionId: null, position: 1, start: 29000, end: 34000, best: null, ready: true,
      });
    });
    await sql`select send_report(${sentId})`;
    log("sent v2");

    await new Promise((r) => setTimeout(r, 50));
    await withActor("tech", (tx) => tx`
      update line_items set note = 'The wipers look good. No streaking.'
      where inspection_id = ${sentId} and component_name = 'Wipers'`);
    out.sent = sentId;

    const base = env().PUBLIC_BASE_URL;
    log("done:");
    for (const [status, id] of Object.entries(out)) console.log(`  ${status.padEnd(17)} ${base}/inspections/${id}`);
    console.log(`  customer link     ${base}/r/${token}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await db().end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
