/**
 * POST /api/inspections/[id]/finish (plan §6, §11).
 * Requires ≥1 piece, all `uploaded`. Sets processing/converting and queues
 * process_inspection, in one transaction.
 *
 * Idempotent: calling it again once processing has started returns 200, so a
 * retry after a dropped response is safe.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { isUuid, jsonError } from "@/lib/http";
import type { InspectionStatus } from "@/lib/types/db";

type Result = { ok: true } | { ok: false; status: number; error: string };

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/finish">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Inspection not found");

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

    await tx`update inspections set status = 'processing', processing_step = 'converting' where id = ${id}`;
    await tx`insert into jobs (inspection_id, kind) values (${id}, 'process_inspection')`;
    return { ok: true };
  });
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json({ ok: true });
}
