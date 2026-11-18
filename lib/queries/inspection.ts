/**
 * Builders for GET /api/inspections and GET /api/inspections/[id].
 * Server-only. Shapes are defined in lib/types/api.ts.
 */
import { sql } from "../db";
import { env } from "../env";
import { mediaUrl } from "../media";
import type {
  ClipDetail,
  InspectionDetail,
  InspectionListItem,
  LineDetail,
  ProgressCounts,
} from "../types/api";
import type {
  AiSuggestionRow,
  ClipRow,
  FrameRow,
  InspectionRow,
  TranscriptSegmentRow,
  LineItemRow,
  MentionRow,
  ReportVersionRow,
  VideoSegmentRow,
} from "../types/db";

/**
 * Derived "unsent changes" (plan §4): any tech edit newer than the latest
 * version's sent_at, or customer/vehicle fields differ from that version.
 */
function unsentChanges(insp: InspectionRow, latest: ReportVersionRow | null, latestTechEditAt: string | null) {
  if (insp.status !== "sent" || !latest) return false;
  if (latestTechEditAt && latestTechEditAt > latest.sent_at) return true;
  return (
    insp.customer_name !== latest.customer_name ||
    insp.vehicle_year !== latest.vehicle_year ||
    insp.vehicle_make !== latest.vehicle_make ||
    insp.vehicle_model !== latest.vehicle_model ||
    insp.vin !== latest.vin
  );
}

export async function listInspections(): Promise<InspectionListItem[]> {
  const rows = await sql<
    (InspectionRow & {
      line_count: number;
      photo_path: string | null;
      ever_sent: boolean;
      unsent_changes: boolean;
    })[]
  >`
    select i.*,
      (select count(*)::int from line_items li where li.inspection_id = i.id) as line_count,
      (select f.storage_path
         from line_items li
         join clips c on c.line_item_id = li.id and c.position = 1
         join frames f on f.id = c.thumbnail_frame_id
        where li.inspection_id = i.id
        order by li.position limit 1) as photo_path,
      (rv.id is not null) as ever_sent,
      coalesce(i.status = 'sent' and (
        exists (select 1 from edits e
                 where e.inspection_id = i.id and e.actor = 'tech' and e.created_at > rv.sent_at)
        or (i.customer_name, i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vin)
           is distinct from (rv.customer_name, rv.vehicle_year, rv.vehicle_make, rv.vehicle_model, rv.vin)
      ), false) as unsent_changes
    from inspections i
    left join lateral (
      select * from report_versions v where v.inspection_id = i.id
      order by v.version_number desc limit 1
    ) rv on true
    -- A recording with no video yet isn't a draft worth listing (the tech backed out).
    where not (i.status = 'recording'
      and not exists (select 1 from video_segments s where s.inspection_id = i.id))
    order by i.created_at desc
    limit 200
  `;
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    processing_step: r.processing_step,
    customer_name: r.customer_name,
    vehicle_year: r.vehicle_year,
    vehicle_make: r.vehicle_make,
    vehicle_model: r.vehicle_model,
    created_at: r.created_at,
    line_count: r.line_count,
    photo_url: r.photo_path ? mediaUrl(r.photo_path) : null,
    ever_sent: r.ever_sent,
    unsent_changes: r.unsent_changes,
  }));
}

/** Returns null if the inspection doesn't exist. */
export async function getInspectionDetail(id: string): Promise<InspectionDetail | null> {
  const [insp] = await sql<InspectionRow[]>`select * from inspections where id = ${id}`;
  if (!insp) return null;

  const [segments, lines, suggestions, mentions, clips, frames, [latest], [techEdit], transcript] = await Promise.all([
    sql<VideoSegmentRow[]>`select * from video_segments where inspection_id = ${id} order by segment_number`,
    sql<LineItemRow[]>`select * from line_items where inspection_id = ${id} order by position`,
    sql<AiSuggestionRow[]>`
      select s.* from ai_suggestions s join line_items li on li.id = s.line_item_id
      where li.inspection_id = ${id}`,
    sql<MentionRow[]>`
      select m.* from mentions m join line_items li on li.id = m.line_item_id
      where li.inspection_id = ${id} order by m.visible_start_ms, m.id`,
    sql<ClipRow[]>`select * from clips where inspection_id = ${id} order by line_item_id, position`,
    sql<FrameRow[]>`
      select f.* from frames f join clips c on c.id = f.clip_id
      where c.inspection_id = ${id} order by f.timestamp_ms, f.id`,
    sql<ReportVersionRow[]>`
      select * from report_versions where inspection_id = ${id}
      order by version_number desc limit 1`,
    sql<{ at: string | null }[]>`
      select max(created_at) as at from edits where inspection_id = ${id} and actor = 'tech'`,
    sql<Pick<TranscriptSegmentRow, "start_ms" | "end_ms" | "text">[]>`
      select start_ms, end_ms, text from transcript_segments where inspection_id = ${id} order by start_ms`,
  ]);

  const framesByClip = new Map<string, FrameRow[]>();
  for (const f of frames) {
    const list = framesByClip.get(f.clip_id) ?? [];
    list.push(f);
    framesByClip.set(f.clip_id, list);
  }
  const frameById = new Map(frames.map((f) => [f.id, f]));

  const clipsByLine = new Map<string, ClipDetail[]>();
  for (const c of clips) {
    const thumb = c.thumbnail_frame_id ? frameById.get(c.thumbnail_frame_id) : undefined;
    const detail: ClipDetail = {
      ...c,
      url: c.path ? mediaUrl(c.path) : null,
      thumbnail_url: thumb ? mediaUrl(thumb.storage_path) : null,
      frames: (framesByClip.get(c.id) ?? []).map((f) => ({ ...f, url: mediaUrl(f.storage_path) })),
    };
    const list = clipsByLine.get(c.line_item_id) ?? [];
    list.push(detail);
    clipsByLine.set(c.line_item_id, list);
  }

  const suggestionByLine = new Map(suggestions.map((s) => [s.line_item_id, s]));
  const mentionsByLine = new Map<string, MentionRow[]>();
  for (const m of mentions) {
    const list = mentionsByLine.get(m.line_item_id) ?? [];
    list.push(m);
    mentionsByLine.set(m.line_item_id, list);
  }

  const lineDetails: LineDetail[] = lines.map((l) => {
    const lineClips = clipsByLine.get(l.id) ?? [];
    const suggestion = suggestionByLine.get(l.id) ?? null;
    return {
      ...l,
      source: suggestion ? "ai" : "tech",
      ai_suggestion: suggestion,
      mentions: mentionsByLine.get(l.id) ?? [],
      clips: lineClips,
      photo_url: lineClips.find((c) => c.position === 1)?.thumbnail_url ?? null,
    };
  });

  const progress: ProgressCounts = {
    segments_total: segments.length,
    segments_uploaded: segments.filter((s) => s.status === "uploaded").length,
    clips_total: clips.length,
    clips_ready: clips.filter((c) => c.status === "ready").length,
    clips_pending: clips.filter((c) => c.status === "pending").length,
    clips_failed: clips.filter((c) => c.status === "failed").length,
  };

  return {
    inspection: insp,
    segments: segments.map((s) => ({ ...s, url: mediaUrl(s.original_path) })),
    video_url: insp.video_path ? mediaUrl(insp.video_path) : null,
    pause_points_ms: segments
      .slice(1)
      .map((s) => s.offset_ms)
      .filter((v): v is number => v !== null),
    lines: lineDetails,
    transcript,
    progress,
    sending: {
      latest_version: latest ? { version_number: latest.version_number, sent_at: latest.sent_at } : null,
      share_url: insp.share_token ? `${env().PUBLIC_BASE_URL}/r/${insp.share_token}` : null,
      unsent_changes: unsentChanges(insp, latest ?? null, techEdit?.at ?? null),
    },
    flags: { enable_reprocess: env().ENABLE_REPROCESS },
  };
}
