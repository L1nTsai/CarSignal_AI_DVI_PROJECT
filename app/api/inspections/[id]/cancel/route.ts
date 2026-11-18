/**
 * POST /api/inspections/[id]/cancel — stop processing during converting or AI
 * review. The inspection goes back to `recording` (a draft): the uploaded parts
 * are kept, and the tech can add more or finish it again. It is not `failed`;
 * that status is for real errors.
 *
 * Queued jobs are marked failed so the worker never claims them. A job that's
 * already running finishes its current step, then finds the inspection is no
 * longer processing and saves nothing (process_inspection re-checks under a row
 * lock before saving). A Gemini call already in flight still completes.
 *
 * Not allowed while cutting: the lines are saved by then and cutting is quick.
 */
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { handle, HttpError, ok, requireUuid } from "@/lib/editor/server";
import { canCancelProcessing } from "@/lib/processing";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/cancel">) {
  return handle(async () => {
    const { id } = await ctx.params;
    requireUuid(id, "Inspection");
    await sql.begin(async (tx) => {
      // Same row lock saveResults takes, so a cancel can't slip in after the AI
      // results are saved: then the step is already 'cutting' and we refuse.
      const [insp] = await tx<{ status: string; processing_step: string | null }[]>`
        select status, processing_step from inspections where id = ${id} for update`;
      if (!insp) throw new HttpError(404, "Inspection not found");
      if (insp.status !== "processing") throw new HttpError(409, "This inspection isn't processing.");
      if (!canCancelProcessing(insp.processing_step)) {
        throw new HttpError(409, "The AI review is done and clips are being cut. It will be ready in a moment.");
      }
      await tx`
        update inspections
        set status = 'recording', processing_step = null
        where id = ${id}`;
      await tx`
        update jobs set status = 'failed', last_error = 'cancelled by tech', run_after = now()
        where inspection_id = ${id} and status = 'queued'`;
    });
    return ok({ status: "recording" });
  });
}
