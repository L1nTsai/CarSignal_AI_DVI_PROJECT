/** POST /api/lines/[lineId]/clips — add a clip { start_ms, end_ms } at the end and queue its cut. */
import type { NextRequest } from "next/server";
import { withActor } from "@/lib/db";
import { clipCreateSchema } from "@/lib/editor/schemas";
import {
  assertEditable,
  assertRangeInVideo,
  handle,
  lockInspectionOfLine,
  ok,
  queueCut,
  readBody,
  requireUuid,
} from "@/lib/editor/server";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/lines/[lineId]/clips">) {
  return handle(async () => {
    const { lineId } = await ctx.params;
    requireUuid(lineId, "Line");
    const range = await readBody(req, clipCreateSchema);
    const clip = await withActor("tech", async (tx) => {
      const insp = await lockInspectionOfLine(tx, lineId);
      assertEditable(insp.status);
      assertRangeInVideo(range, insp.duration_ms);
      const [row] = await tx<{ id: string; position: number }[]>`
        insert into clips (inspection_id, line_item_id, position, start_ms, end_ms)
        values (
          ${insp.id}, ${lineId},
          (select coalesce(max(position), 0) + 1 from clips where line_item_id = ${lineId}),
          ${range.start_ms}, ${range.end_ms}
        )
        returning id, position`;
      await queueCut(tx, insp.id, row.id);
      return row;
    });
    return ok(clip, 201);
  });
}
