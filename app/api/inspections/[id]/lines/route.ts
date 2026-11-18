/**
 * POST /api/inspections/[id]/lines — add a tech line at the end.
 * Body: { component_name, rating, note?, clip?: { start_ms, end_ms } }.
 * With `clip`, its first clip is created too and a cut is queued.
 */
import type { NextRequest } from "next/server";
import { guessZone } from "@/lib/carZones";
import { withActor } from "@/lib/db";
import { lineCreateSchema } from "@/lib/editor/schemas";
import {
  assertEditable,
  assertRangeInVideo,
  handle,
  lockInspection,
  ok,
  queueCut,
  readBody,
  requireUuid,
} from "@/lib/editor/server";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/lines">) {
  return handle(async () => {
    const { id } = await ctx.params;
    requireUuid(id, "Inspection");
    const body = await readBody(req, lineCreateSchema);
    const result = await withActor("tech", async (tx) => {
      const insp = await lockInspection(tx, id);
      assertEditable(insp.status);
      if (body.clip) assertRangeInVideo(body.clip, insp.duration_ms);
      const [line] = await tx<{ id: string }[]>`
        insert into line_items (inspection_id, position, component_name, note, rating, car_zone)
        values (
          ${id},
          (select coalesce(max(position), 0) + 1 from line_items where inspection_id = ${id}),
          ${body.component_name}, ${body.note}, ${body.rating},
          ${body.car_zone === undefined ? guessZone(body.component_name) : body.car_zone}
        )
        returning id`;
      let clipId: string | null = null;
      if (body.clip) {
        const [clip] = await tx<{ id: string }[]>`
          insert into clips (inspection_id, line_item_id, position, start_ms, end_ms)
          values (${id}, ${line.id}, 1, ${body.clip.start_ms}, ${body.clip.end_ms})
          returning id`;
        clipId = clip.id;
        await queueCut(tx, id, clip.id);
      }
      return { id: line.id, clip_id: clipId };
    });
    return ok(result, 201);
  });
}
