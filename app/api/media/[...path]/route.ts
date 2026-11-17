/**
 * GET /api/media/[...path] — tech-side Storage proxy with Range support (plan §5).
 * The path is the storage path inside the inspection-media bucket.
 */
import type { NextRequest } from "next/server";
import { proxyStorageObject, safeStoragePath } from "@/lib/mediaProxy";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/media/[...path]">) {
  const { path } = await ctx.params;
  const storagePath = safeStoragePath(path);
  if (!storagePath) return new Response("Bad path", { status: 400 });
  return proxyStorageObject(req, storagePath);
}

export const HEAD = GET;
