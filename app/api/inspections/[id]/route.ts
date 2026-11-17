/**
 * GET /api/inspections/[id] — everything for the inspection page
 * (InspectionDetail in lib/types/api.ts).
 *
 * PATCH / DELETE are owned by the editor/home agents (plan §11).
 */
import { NextResponse, type NextRequest } from "next/server";
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
