/**
 * POST /api/inspections/[id]/reprocess — development only (404 unless
 * ENABLE_REPROCESS=true). Only from `ready_for_review`, never after sending.
 * Re-runs the AI on the stitched video; the worker replaces all lines.
 */
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, HttpError, ok, requireUuid } from "@/lib/editor/server";
import { jsonError } from "@/lib/http";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/reprocess">) {
  if (!env().ENABLE_REPROCESS) return jsonError(404, "Not found");
  return handle(async () => {
    const { id } = await ctx.params;
    requireUuid(id, "Inspection");
    await sql.begin(async (tx) => {
      const [insp] = await tx<{ status: string; video_path: string | null }[]>`
        select status, video_path from inspections where id = ${id} for update`;
      if (!insp) throw new HttpError(404, "Inspection not found");
      if (insp.status === "sent") throw new HttpError(409, "Re-process isn't available after sending");
      if (insp.status !== "ready_for_review") {
        throw new HttpError(409, "Re-process is only available when the inspection is ready for review");
      }
      if (!insp.video_path) throw new HttpError(409, "There's no stitched video to re-process");
      // Clip cuts / frame extractions still queued would work on lines that are about to be replaced.
      await tx`delete from jobs where inspection_id = ${id} and kind <> 'process_inspection' and status = 'queued'`;
      await tx`update inspections set status = 'processing', processing_step = 'analyzing' where id = ${id}`;
      const inserted = await tx`
        insert into jobs (inspection_id, kind) values (${id}, 'process_inspection')
        on conflict (inspection_id) where kind = 'process_inspection' and status in ('queued','running') do nothing
        returning id`;
      if (inserted.length === 0) throw new HttpError(409, "This inspection is already being processed");
    });
    return ok({ status: "processing" }, 202);
  });
}
