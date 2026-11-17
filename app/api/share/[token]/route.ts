/** GET /api/share/[token]?v= — customer report (ShareResponse in lib/types/api.ts). */
import { NextResponse, type NextRequest } from "next/server";
import { isShareToken, jsonError } from "@/lib/http";
import { getShare } from "@/lib/queries/share";
import type { ShareResponse } from "@/lib/types/api";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/share/[token]">) {
  const { token } = await ctx.params;
  if (!isShareToken(token)) return jsonError(404, "Report not found");

  const vParam = req.nextUrl.searchParams.get("v");
  let v: number | undefined;
  if (vParam !== null) {
    v = Number(vParam);
    if (!Number.isInteger(v) || v < 1) return jsonError(400, "Invalid version");
  }

  const data = await getShare(token, v);
  if (!data) return jsonError(404, "Report not found");
  return NextResponse.json<ShareResponse>(data, { headers: { "cache-control": "no-store" } });
}
