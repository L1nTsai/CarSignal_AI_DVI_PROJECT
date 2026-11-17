/**
 * GET /api/share/[token]/media/[clipId]/[kind] — customer-side media.
 * clipId is a report_version_clips.id; kind is "clip" or "thumbnail".
 * Scoped to the share token so storage paths (which contain the inspection id,
 * i.e. the edit URL) are never revealed to customers.
 */
import type { NextRequest } from "next/server";
import { isShareToken, isUuid } from "@/lib/http";
import { proxyStorageObject } from "@/lib/mediaProxy";
import { getShareMediaPath } from "@/lib/queries/share";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/share/[token]/media/[clipId]/[kind]">) {
  const { token, clipId, kind } = await ctx.params;
  if (!isShareToken(token) || !isUuid(clipId) || (kind !== "clip" && kind !== "thumbnail")) {
    return new Response("Not found", { status: 404 });
  }
  const path = await getShareMediaPath(token, clipId, kind);
  if (!path) return new Response("Not found", { status: 404 });
  return proxyStorageObject(req, path);
}

export const HEAD = GET;
