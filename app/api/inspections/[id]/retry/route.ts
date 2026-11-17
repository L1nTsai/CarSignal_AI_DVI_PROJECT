/**
 * POST /api/inspections/[id]/retry — only from `failed`, and never after a
 * cancel (409; cancelling is final). Back to `processing`
 * and queue process_inspection again. Starts at converting unless the stitched
 * video already exists (the worker then skips straight to the AI step).
 */
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { handle, HttpError, ok, requireUuid } from "@/lib/editor/server";
import { isCancelled } from "@/lib/processing";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/retry">) {
  return handle(async () => {
    const { id } = await ctx.params;
    requireUuid(id, "Inspection");
    await sql.begin(async (tx) => {
      const [insp] = await tx<{ status: string; video_path: string | null; failure_reason: string | null }[]>`
        select status, video_path, failure_reason from inspections where id = ${id} for update`;
      if (!insp) throw new HttpError(404, "Inspection not found");
      if (insp.status !== "failed") throw new HttpError(409, "Only a failed inspection can be retried");
      // Cancel is final (owner decision 2026-11-17). This also closes the race
      // where a Retry lands while the cancelled job is still running.
      if (isCancelled(insp.failure_reason)) {
        throw new HttpError(409, "A cancelled inspection can't be restarted. Delete it or start a new one.");
      }
      await tx`
        update inspections
        set status = 'processing',
            processing_step = ${insp.video_path ? "analyzing" : "converting"},
            failure_reason = null
        where id = ${id}`;
      await tx`
        insert into jobs (inspection_id, kind) values (${id}, 'process_inspection')
        on conflict (inspection_id) where kind = 'process_inspection' and status in ('queued','running') do nothing`;
    });
    return ok({ status: "processing" }, 202);
  });
}
