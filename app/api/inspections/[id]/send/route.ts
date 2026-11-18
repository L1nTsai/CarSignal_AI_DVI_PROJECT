/**
 * POST /api/inspections/[id]/send — Send to customer / Send update.
 *
 * send_report() does every check and writes the frozen version in one
 * transaction. Its `raise exception` messages are written for the tech and
 * come back as 409 { error }.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isRaisedException, sql } from "@/lib/db";
import { publicBaseUrl } from "@/lib/baseUrl";
import { isUuid, jsonError } from "@/lib/http";
import type { SendResponse } from "@/lib/sharing/types";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/send">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Inspection not found");

  let result: { token: string; version_number: number };
  try {
    // Same transaction, so the row lock taken by send_report covers the
    // version lookup and a concurrent Send can't slip in between.
    result = await sql.begin(async (tx) => {
      const [{ token }] = await tx<{ token: string }[]>`select send_report(${id}) as token`;
      const [{ version_number }] = await tx<{ version_number: number }[]>`
        select max(version_number)::int as version_number from report_versions where inspection_id = ${id}`;
      return { token, version_number };
    });
  } catch (e) {
    if (isRaisedException(e)) {
      if (e.message === "inspection not found") return jsonError(404, "Inspection not found");
      return jsonError(409, capitalize(e.message));
    }
    throw e;
  }

  return NextResponse.json<SendResponse>({
    shareUrl: `${await publicBaseUrl()}/r/${result.token}`,
    version_number: result.version_number,
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
