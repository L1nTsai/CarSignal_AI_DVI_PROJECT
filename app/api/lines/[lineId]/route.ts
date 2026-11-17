/**
 * PATCH /api/lines/[lineId] — { component_name?, note?, rating? }.
 * DELETE /api/lines/[lineId] — delete the line (clips cascade) and close the gap in positions.
 */
import type { NextRequest } from "next/server";
import { withActor } from "@/lib/db";
import { linePatchSchema } from "@/lib/editor/schemas";
import { assertEditable, handle, lockInspectionOfLine, ok, readBody, requireUuid } from "@/lib/editor/server";
import type { LineItemRow } from "@/lib/types/db";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/lines/[lineId]">) {
  return handle(async () => {
    const { lineId } = await ctx.params;
    requireUuid(lineId, "Line");
    const patch = await readBody(req, linePatchSchema);
    const row = await withActor("tech", async (tx) => {
      const insp = await lockInspectionOfLine(tx, lineId);
      assertEditable(insp.status);
      const [updated] = await tx<LineItemRow[]>`
        update line_items set ${tx(patch, ...(Object.keys(patch) as (keyof typeof patch)[]))}
        where id = ${lineId}
        returning *`;
      return updated;
    });
    return ok(row);
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/lines/[lineId]">) {
  return handle(async () => {
    const { lineId } = await ctx.params;
    requireUuid(lineId, "Line");
    await withActor("tech", async (tx) => {
      const insp = await lockInspectionOfLine(tx, lineId);
      assertEditable(insp.status);
      await tx`delete from line_items where id = ${lineId}`;
      // Positions stay 1..n (the unique constraint is checked at commit).
      await tx`
        update line_items li set position = r.rn
        from (select id, row_number() over (order by position) as rn
              from line_items where inspection_id = ${insp.id}) r
        where li.id = r.id and li.position <> r.rn`;
    });
    return new Response(null, { status: 204 });
  });
}
