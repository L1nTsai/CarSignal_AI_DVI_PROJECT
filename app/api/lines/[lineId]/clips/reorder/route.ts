/** POST /api/lines/[lineId]/clips/reorder — body { ids } lists every clip of the line once. The first becomes the main clip. */
import type { NextRequest } from "next/server";
import { withActor } from "@/lib/db";
import { reorderSchema } from "@/lib/editor/schemas";
import { assertEditable, handle, lockInspectionOfLine, ok, readBody, requireUuid } from "@/lib/editor/server";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/lines/[lineId]/clips/reorder">) {
  return handle(async () => {
    const { lineId } = await ctx.params;
    requireUuid(lineId, "Line");
    const { ids } = await readBody(req, reorderSchema);
    await withActor("tech", async (tx) => {
      const insp = await lockInspectionOfLine(tx, lineId);
      assertEditable(insp.status);
      await tx`select reorder_clips(${lineId}, ${ids}::uuid[])`;
    });
    return ok({ ids });
  });
}
