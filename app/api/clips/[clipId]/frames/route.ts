/**
 * POST /api/clips/[clipId]/frames — { timestamp_ms } on the stitched timeline,
 * inside the clip's range. Queues extract_frame; the worker adds a
 * 'tech_picked' frame and makes it the clip's thumbnail.
 */
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { frameCreateSchema } from "@/lib/editor/schemas";
import {
  assertEditable,
  handle,
  HttpError,
  lockInspectionOfClip,
  ok,
  readBody,
  requireUuid,
} from "@/lib/editor/server";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/clips/[clipId]/frames">) {
  return handle(async () => {
    const { clipId } = await ctx.params;
    requireUuid(clipId, "Clip");
    const { timestamp_ms } = await readBody(req, frameCreateSchema);
    const job = await sql.begin(async (tx) => {
      const { inspection } = await lockInspectionOfClip(tx, clipId);
      assertEditable(inspection.status);
      const [clip] = await tx<{ start_ms: number; end_ms: number }[]>`
        select start_ms, end_ms from clips where id = ${clipId}`;
      if (timestamp_ms < clip.start_ms || timestamp_ms > clip.end_ms) {
        throw new HttpError(400, "Pick a moment inside this clip");
      }
      const [row] = await tx<{ id: string }[]>`
        insert into jobs (inspection_id, clip_id, kind, frame_timestamp_ms)
        values (${inspection.id}, ${clipId}, 'extract_frame', ${timestamp_ms})
        returning id`;
      return row;
    });
    return ok({ job_id: job.id }, 202);
  });
}
