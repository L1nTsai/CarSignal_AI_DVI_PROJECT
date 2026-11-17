/**
 * Builder for GET /api/share/[token]?v= and lookup for share-scoped media.
 * Server-only. Shape is defined in lib/types/api.ts (ShareResponse).
 */
import { createHash } from "node:crypto";
import { sql } from "../db";
import { shareMediaUrl } from "../media";
import type { ShareResponse, ShareVersion } from "../types/api";
import type { ReportVersionClipRow, ReportVersionLineRow, ReportVersionRow } from "../types/db";

/** Opaque, stable-per-report line key. Never reveals the live line id. */
function lineKey(token: string, sourceLineId: string): string {
  return createHash("sha256").update(`${token}:${sourceLineId}`).digest("base64url").slice(0, 16);
}

async function loadVersion(token: string, v: ReportVersionRow): Promise<ShareVersion> {
  const [lines, clips] = await Promise.all([
    sql<ReportVersionLineRow[]>`
      select * from report_version_lines where report_version_id = ${v.id} order by position`,
    sql<ReportVersionClipRow[]>`
      select c.* from report_version_clips c
      join report_version_lines l on l.id = c.report_version_line_id
      where l.report_version_id = ${v.id}
      order by c.report_version_line_id, c.position`,
  ]);
  const clipsByLine = new Map<string, ReportVersionClipRow[]>();
  for (const c of clips) {
    const list = clipsByLine.get(c.report_version_line_id) ?? [];
    list.push(c);
    clipsByLine.set(c.report_version_line_id, list);
  }
  return {
    version_number: v.version_number,
    sent_at: v.sent_at,
    customer_name: v.customer_name,
    vehicle_year: v.vehicle_year,
    vehicle_make: v.vehicle_make,
    vehicle_model: v.vehicle_model,
    vin: v.vin,
    lines: lines.map((l) => ({
      key: lineKey(token, l.source_line_id),
      position: l.position,
      component_name: l.component_name,
      note: l.note,
      rating: l.rating,
      clips: (clipsByLine.get(l.id) ?? []).map((c) => ({
        position: c.position,
        clip_url: shareMediaUrl(token, c.id, "clip"),
        thumbnail_url: shareMediaUrl(token, c.id, "thumbnail"),
      })),
    })),
  };
}

/**
 * Returns null when the token is unknown or the requested version doesn't
 * exist (both -> 404). `versionNumber` undefined = latest.
 */
export async function getShare(token: string, versionNumber?: number): Promise<ShareResponse | null> {
  const versions = await sql<ReportVersionRow[]>`
    select v.* from report_versions v
    join inspections i on i.id = v.inspection_id
    where i.share_token = ${token}
    order by v.version_number`;
  if (versions.length === 0) return null;

  const latest = versions[versions.length - 1];
  const idx = versionNumber === undefined ? versions.length - 1 : versions.findIndex((v) => v.version_number === versionNumber);
  if (idx < 0) return null;

  const [version, previous] = await Promise.all([
    loadVersion(token, versions[idx]),
    idx > 0 ? loadVersion(token, versions[idx - 1]) : Promise.resolve(null),
  ]);

  return {
    version,
    previous,
    versions: versions.map((v) => ({ version_number: v.version_number, sent_at: v.sent_at })),
    latest_version_number: latest.version_number,
  };
}

/** Storage path for a share-scoped media request, or null if it doesn't belong to this token. */
export async function getShareMediaPath(
  token: string,
  versionClipId: string,
  kind: "clip" | "thumbnail",
): Promise<string | null> {
  const [row] = await sql<{ clip_path: string; thumbnail_path: string }[]>`
    select c.clip_path, c.thumbnail_path
    from report_version_clips c
    join report_version_lines l on l.id = c.report_version_line_id
    join report_versions v on v.id = l.report_version_id
    join inspections i on i.id = v.inspection_id
    where c.id = ${versionClipId} and i.share_token = ${token}`;
  if (!row) return null;
  return kind === "clip" ? row.clip_path : row.thumbnail_path;
}
