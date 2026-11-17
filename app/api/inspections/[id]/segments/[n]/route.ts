/**
 * DELETE /api/inspections/[id]/segments/[n] — Retake (plan §6, §11).
 * Only while `recording`, and only the highest-numbered piece.
 * 204 on success.
 */
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { isUuid, jsonError } from "@/lib/http";
import { removeObjects } from "@/lib/storage";
import type { InspectionStatus } from "@/lib/types/db";

type Result = { ok: true; path: string } | { ok: false; status: number; error: string };

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/segments/[n]">) {
  const { id, n: nParam } = await ctx.params;
  const n = Number(nParam);
  if (!isUuid(id)) return jsonError(404, "Inspection not found");
  if (!Number.isInteger(n) || n < 1) return jsonError(400, "Invalid part number");

  const result = await sql.begin(async (tx): Promise<Result> => {
    const [insp] = await tx<{ status: InspectionStatus }[]>`
      select status from inspections where id = ${id} for update`;
    if (!insp) return { ok: false, status: 404, error: "Inspection not found" };
    if (insp.status !== "recording") return { ok: false, status: 409, error: "Recording has already finished" };

    const [{ max }] = await tx<{ max: number }[]>`
      select coalesce(max(segment_number), 0)::int as max from video_segments where inspection_id = ${id}`;
    if (max === 0 || n > max) return { ok: false, status: 404, error: `Part ${n} not found` };
    if (n !== max) return { ok: false, status: 409, error: "Only the last part can be retaken" };

    const [row] = await tx<{ original_path: string }[]>`
      delete from video_segments where inspection_id = ${id} and segment_number = ${n}
      returning original_path`;
    return { ok: true, path: row.original_path };
  });
  if (!result.ok) return jsonError(result.status, result.error);

  // Row is gone either way; a leftover file is harmless and will be reused by the next upload of n.
  await removeObjects([result.path]).catch((err) => console.error("segment file delete failed", err));
  return new Response(null, { status: 204 });
}
