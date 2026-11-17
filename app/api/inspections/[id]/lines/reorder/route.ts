/** POST /api/inspections/[id]/lines/reorder — body { ids } lists every line once, in the new order. */
import type { NextRequest } from "next/server";
import { withActor } from "@/lib/db";
import { reorderSchema } from "@/lib/editor/schemas";
import { assertEditable, handle, lockInspection, ok, readBody, requireUuid } from "@/lib/editor/server";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/lines/reorder">) {
  return handle(async () => {
    const { id } = await ctx.params;
    requireUuid(id, "Inspection");
    const { ids } = await readBody(req, reorderSchema);
    await withActor("tech", async (tx) => {
      const insp = await lockInspection(tx, id);
      assertEditable(insp.status);
      await tx`select reorder_lines(${id}, ${ids}::uuid[])`;
    });
    return ok({ ids });
  });
}
