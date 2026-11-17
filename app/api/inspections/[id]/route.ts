/**
 * GET /api/inspections/[id] — everything for the inspection page
 * (InspectionDetail in lib/types/api.ts).
 *
 * PATCH /api/inspections/[id] — customer and vehicle details (editor).
 * DELETE /api/inspections/[id] — home list delete (any status except processing).
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { inspectionPatchSchema } from "@/lib/editor/schemas";
import { handle, HttpError, readBody, requireUuid } from "@/lib/editor/server";
import { isUuid, jsonError } from "@/lib/http";
import { storagePaths } from "@/lib/paths";
import { removePrefix } from "@/lib/storage";
import { getInspectionDetail } from "@/lib/queries/inspection";
import type { InspectionDetail } from "@/lib/types/api";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Inspection not found");
  const data = await getInspectionDetail(id);
  if (!data) return jsonError(404, "Inspection not found");
  return NextResponse.json<InspectionDetail>(data, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/inspections/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    requireUuid(id, "Inspection");
    const patch = await readBody(req, inspectionPatchSchema);
    const [current] = await sql<{ status: string }[]>`select status from inspections where id = ${id}`;
    if (!current) throw new HttpError(404, "Inspection not found");
    if (current.status === "sent" && Object.values(patch).some((v) => v === null)) {
      throw new HttpError(400, "Customer and vehicle details can't be cleared after sending");
    }
    const [row] = await sql`
      update inspections set ${sql(patch, ...(Object.keys(patch) as (keyof typeof patch)[]))}
      where id = ${id}
      returning customer_name, vehicle_year, vehicle_make, vehicle_model, vin`;
    if (!row) throw new HttpError(404, "Inspection not found");
    return NextResponse.json(row);
  });
}

/**
 * Allowed for every status except processing (would race the worker). Deleting a
 * sent inspection also deletes its sent versions, so the customer link stops
 * working. Deletes the row (everything cascades), then every Storage object under `{id}/`.
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Inspection not found");

  const outcome = await sql.begin(async (tx) => {
    const [row] = await tx<{ status: string }[]>`select status from inspections where id = ${id} for update`;
    if (!row) return "not_found" as const;
    if (row.status === "processing") return "processing" as const;
    await tx`delete from inspections where id = ${id}`;
    return "deleted" as const;
  });

  if (outcome === "not_found") return jsonError(404, "Inspection not found");
  if (outcome === "processing") return jsonError(409, "Wait for processing to finish before deleting.");

  try {
    await removePrefix(storagePaths.inspectionPrefix(id));
  } catch (e) {
    // The row is gone, so the inspection is deleted as far as the app is
    // concerned; leftover files are only wasted space. Log for cleanup.
    console.error(`[delete] inspection ${id} deleted but Storage cleanup failed:`, e);
  }
  return new NextResponse(null, { status: 204 });
}
