/**
 * PATCH /api/clips/[clipId]
 *   { start_ms, end_ms }      new range: status -> pending, queue cut_clip (also works as a retry)
 *   { thumbnail_frame_id }    pick one of the clip's frames as its thumbnail
 * DELETE /api/clips/[clipId] — delete the clip and close the gap in positions.
 * Media files are kept: sent versions may still point at them.
 */
import type { NextRequest } from "next/server";
import { withActor } from "@/lib/db";
import { clipPatchSchema } from "@/lib/editor/schemas";
import {
  assertEditable,
  assertRangeInVideo,
  handle,
  HttpError,
  lockInspectionOfClip,
  ok,
  queueCut,
  readBody,
  requireUuid,
} from "@/lib/editor/server";
import type { ClipRow } from "@/lib/types/db";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/clips/[clipId]">) {
  return handle(async () => {
    const { clipId } = await ctx.params;
    requireUuid(clipId, "Clip");
    const patch = await readBody(req, clipPatchSchema);
    const row = await withActor("tech", async (tx) => {
      const { inspection } = await lockInspectionOfClip(tx, clipId);
      assertEditable(inspection.status);
      if ("thumbnail_frame_id" in patch) {
        const [frame] = await tx`select 1 from frames where id = ${patch.thumbnail_frame_id} and clip_id = ${clipId}`;
        if (!frame) throw new HttpError(400, "That photo doesn't belong to this clip");
        const [updated] = await tx<ClipRow[]>`
          update clips set thumbnail_frame_id = ${patch.thumbnail_frame_id} where id = ${clipId} returning *`;
        return updated;
      }
      assertRangeInVideo(patch, inspection.duration_ms);
      const [updated] = await tx<ClipRow[]>`
        update clips set start_ms = ${patch.start_ms}, end_ms = ${patch.end_ms}, status = 'pending'
        where id = ${clipId} returning *`;
      await queueCut(tx, inspection.id, clipId);
      return updated;
    });
    return ok(row);
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/clips/[clipId]">) {
  return handle(async () => {
    const { clipId } = await ctx.params;
    requireUuid(clipId, "Clip");
    await withActor("tech", async (tx) => {
      const { inspection, lineId } = await lockInspectionOfClip(tx, clipId);
      assertEditable(inspection.status);
      await tx`delete from clips where id = ${clipId}`;
      await tx`
        update clips c set position = r.rn
        from (select id, row_number() over (order by position) as rn
              from clips where line_item_id = ${lineId}) r
        where c.id = r.id and c.position <> r.rn`;
    });
    return new Response(null, { status: 204 });
  });
}
