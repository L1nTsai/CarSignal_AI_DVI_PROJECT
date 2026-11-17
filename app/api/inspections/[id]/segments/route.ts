/**
 * POST /api/inspections/[id]/segments?n= — upload one recorded piece (plan §6, §11).
 * Body: the raw blob; content-type: its MIME type (video/mp4 or video/webm).
 *
 * Rules:
 * - Only while the inspection is `recording`.
 * - n must be the next number (highest + 1), or an existing piece that isn't
 *   `uploaded` yet (a retried upload). An `uploaded` piece is never replaced:
 *   retake it with DELETE first.
 * - The body is streamed straight into Storage, never buffered.
 *
 * 201 { segment_number, status: "uploaded" }
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { isUuid, jsonError } from "@/lib/http";
import { storagePaths } from "@/lib/paths";
import { isAllowedSegmentMime, MAX_SEGMENTS } from "@/lib/recording";
import { removeObjects, uploadStream } from "@/lib/storage";
import type { InspectionStatus, SegmentStatus } from "@/lib/types/db";

type Claim =
  | { ok: true; segmentId: string; path: string; previousPath: string | null }
  | { ok: false; status: number; error: string; code?: string };

export async function POST(req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/segments">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Inspection not found");

  const n = Number(req.nextUrl.searchParams.get("n"));
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEGMENTS) return jsonError(400, `n must be an integer from 1 to ${MAX_SEGMENTS}`);

  const contentType = req.headers.get("content-type");
  if (!isAllowedSegmentMime(contentType)) return jsonError(415, "Body must be video/mp4 or video/webm");
  if (!req.body) return jsonError(400, "Empty body");
  const lenHeader = req.headers.get("content-length");
  const contentLength = lenHeader !== null ? Number(lenHeader) : undefined;
  if (contentLength === 0) return jsonError(400, "Empty body");

  const path = storagePaths.segment(id, n, contentType);

  // 1. Claim the slot (short transaction; the upload happens outside it).
  const claim = await sql.begin(async (tx): Promise<Claim> => {
    const [insp] = await tx<{ status: InspectionStatus }[]>`
      select status from inspections where id = ${id} for update`;
    if (!insp) return { ok: false, status: 404, error: "Inspection not found" };
    if (insp.status !== "recording") return { ok: false, status: 409, error: "Recording has already finished", code: "not_recording" };

    const [existing] = await tx<{ id: string; status: SegmentStatus; original_path: string }[]>`
      select id, status, original_path from video_segments where inspection_id = ${id} and segment_number = ${n}`;
    if (existing) {
      if (existing.status === "uploaded") return { ok: false, status: 409, error: `Part ${n} is already uploaded`, code: "already_uploaded" };
      await tx`
        update video_segments set status = 'uploading', original_path = ${path}, mime_type = ${contentType}
        where id = ${existing.id}`;
      return {
        ok: true,
        segmentId: existing.id,
        path,
        previousPath: existing.original_path !== path ? existing.original_path : null,
      };
    }

    const [{ max }] = await tx<{ max: number }[]>`
      select coalesce(max(segment_number), 0)::int as max from video_segments where inspection_id = ${id}`;
    if (n !== max + 1) return { ok: false, status: 409, error: `Expected part ${max + 1}, got ${n}` };

    const [row] = await tx<{ id: string }[]>`
      insert into video_segments (inspection_id, segment_number, status, original_path, mime_type)
      values (${id}, ${n}, 'uploading', ${path}, ${contentType})
      returning id`;
    return { ok: true, segmentId: row.id, path, previousPath: null };
  });
  if (!claim.ok) return jsonError(claim.status, claim.error, claim.code);

  // 2. Stream to Storage.
  try {
    await uploadStream(path, req.body, contentType, contentLength, { upsert: true });
  } catch (err) {
    console.error("segment upload failed", { id, n, err });
    await sql`update video_segments set status = 'failed' where id = ${claim.segmentId} and status = 'uploading'`;
    return jsonError(502, "Upload failed. Try again.");
  }

  // 3. Mark uploaded — unless the piece was retaken (deleted) meanwhile.
  const done = await sql`
    update video_segments set status = 'uploaded'
    where id = ${claim.segmentId} and status = 'uploading'`;
  if (done.count === 0) {
    await removeObjects([path]).catch(() => {});
    return jsonError(409, `Part ${n} was removed during upload`);
  }
  if (claim.previousPath) await removeObjects([claim.previousPath]).catch(() => {});

  return NextResponse.json({ segment_number: n, status: "uploaded" as const }, { status: 201 });
}
