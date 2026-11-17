/**
 * GET /api/inspections/[id] — everything for the inspection page
 * (InspectionDetail in lib/types/api.ts).
 *
 * PATCH /api/inspections/[id] — customer and vehicle details (editor).
 * DELETE is owned by the home agent (plan §11).
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { inspectionPatchSchema } from "@/lib/editor/schemas";
import { handle, HttpError, readBody, requireUuid } from "@/lib/editor/server";
import { isUuid, jsonError } from "@/lib/http";
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
