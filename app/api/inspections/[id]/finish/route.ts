/**
 * POST /api/inspections/[id]/finish (plan §6, §11).
 * Requires ≥1 piece, all `uploaded`. Sets processing/converting and queues
 * process_inspection, in one transaction.
 *
 * A piece whose picture stopped early (`video_cut_at_ms`, set by the upload
 * check) blocks with 409 `code: video_cut` unless the body is
 * `{ allow_video_cut: true }` (the tech chose to finish anyway).
 *
 * Idempotent: calling it again once processing has started returns 200, so a
 * retry after a dropped response is safe.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { isUuid, jsonError } from "@/lib/http";
import type { InspectionStatus } from "@/lib/types/db";

type Result = { ok: true } | { ok: false; status: number; error: string; code?: string };

export async function POST(req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/finish">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Inspection not found");
  const body = (await req.json().catch(() => null)) as { allow_video_cut?: unknown } | null;
  const allowVideoCut = body?.allow_video_cut === true;

  const result = await sql.begin(async (tx): Promise<Result> => {
    const [insp] = await tx<{ status: InspectionStatus }[]>`
      select status from inspections where id = ${id} for update`;
    if (!insp) return { ok: false, status: 404, error: "Inspection not found" };
    if (insp.status !== "recording") {
      return insp.status === "processing"
        ? { ok: true }
        : { ok: false, status: 409, error: "Recording has already finished" };
    }

    const [counts] = await tx<{ total: number; uploaded: number; max: number }[]>`
      select count(*)::int as total,
             count(*) filter (where status = 'uploaded')::int as uploaded,
             coalesce(max(segment_number), 0)::int as max
      from video_segments where inspection_id = ${id}`;
    if (counts.total === 0) return { ok: false, status: 409, error: "Record at least one part first" };
    if (counts.uploaded !== counts.total) return { ok: false, status: 409, error: "Some parts are still uploading" };
    if (counts.max !== counts.total) return { ok: false, status: 409, error: "Recorded parts are out of order" };

    if (!allowVideoCut) {
      const [cut] = await tx<{ segment_number: number }[]>`
        select segment_number from video_segments
        where inspection_id = ${id} and video_cut_at_ms is not null
        order by segment_number limit 1`;
      if (cut) {
        return {
          ok: false,
          status: 409,
          code: "video_cut",
          error: `The camera stopped during part ${cut.segment_number}, so its video freezes. Retake it, or finish anyway.`,
        };
      }
    }

    await tx`update inspections set status = 'processing', processing_step = 'converting' where id = ${id}`;
    await tx`insert into jobs (inspection_id, kind) values (${id}, 'process_inspection')`;
    return { ok: true };
  });
  if (!result.ok) return jsonError(result.status, result.error, result.code);
  return NextResponse.json({ ok: true });
}
