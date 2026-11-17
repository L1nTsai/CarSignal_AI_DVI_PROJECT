/**
 * GET /api/inspections/[id] — everything for the inspection page
 * (InspectionDetail in lib/types/api.ts).
 *
 * DELETE /api/inspections/[id] — home list delete (never-sent only).
 *
 * PATCH is owned by the editor agent (plan §11).
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
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

/**
 * Allowed for recording / ready_for_review / failed. 409 for sent (history must
 * be kept) and processing (would race the worker). Deletes the row (everything
 * cascades), then every Storage object under `{id}/`.
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Inspection not found");

  const outcome = await sql.begin(async (tx) => {
    const [row] = await tx<{ status: string; ever_sent: boolean }[]>`
      select status, exists (select 1 from report_versions v where v.inspection_id = i.id) as ever_sent
      from inspections i where id = ${id} for update`;
    if (!row) return "not_found" as const;
    if (row.status === "sent" || row.ever_sent) return "sent" as const;
    if (row.status === "processing") return "processing" as const;
    await tx`delete from inspections where id = ${id}`;
    return "deleted" as const;
  });

  if (outcome === "not_found") return jsonError(404, "Inspection not found");
  if (outcome === "sent") return jsonError(409, "Sent inspections can't be deleted.");
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
