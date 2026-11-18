/**
 * Exact JSON shapes returned by the API. Pure types; safe to import from
 * client components. Builders live in lib/queries/*.ts — change both together.
 *
 * Every error response is `ApiError` with an appropriate HTTP status.
 */
import type {
  AiSuggestionRow,
  ClipRow,
  FrameRow,
  InspectionRow,
  InspectionStatus,
  LineItemRow,
  LineRating,
  MentionRow,
  ProcessingStep,
  VideoSegmentRow,
} from "./db";
import type { ClipAnnotation } from "../annotations";
import type { CarZone } from "../carZones";

export interface ApiError {
  error: string;
  /** Machine-readable reason, when a client needs to branch on it. */
  code?: string;
}

// ── GET /api/inspections ─────────────────────────────────────────────────────
// Newest first.
export interface InspectionListItem {
  id: string;
  status: InspectionStatus;
  processing_step: ProcessingStep | null;
  customer_name: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  created_at: string;
  line_count: number;
  /** Main photo of the first line, if any (tech media URL). */
  photo_url: string | null;
  /** True once sent at least once. Deleting it then also disables the customer link. */
  ever_sent: boolean;
  /** Only meaningful when status === 'sent'. */
  unsent_changes: boolean;
}
export interface InspectionListResponse {
  inspections: InspectionListItem[];
}

// ── POST /api/inspections ────────────────────────────────────────────────────
export interface CreateInspectionResponse {
  id: string;
}

// ── GET /api/inspections/[id] ────────────────────────────────────────────────
export interface InspectionDetail {
  inspection: InspectionRow;
  /** Ordered by segment_number. */
  segments: SegmentDetail[];
  /** Stitched video (tech media URL) once converting is done. */
  video_url: string | null;
  /**
   * Pause points on the stitched timeline, in ms: the offset_ms of segments
   * 2..n. Empty until the worker has stitched. Used for timeline markers.
   */
  pause_points_ms: number[];
  /** Ordered by position. */
  lines: LineDetail[];
  /**
   * Everything the tech said, as timed captions (ordered by start_ms). Tech-only.
   * Empty for inspections processed before transcripts existed (re-process to get one).
   */
  transcript: { start_ms: number; end_ms: number; text: string }[];
  progress: ProgressCounts;
  sending: SendingState;
  flags: { enable_reprocess: boolean };
}

export interface SegmentDetail extends VideoSegmentRow {
  /** Tech media URL of the original upload. */
  url: string;
}

export interface LineDetail extends LineItemRow {
  /** 'ai' if an ai_suggestions row exists, else 'tech'. */
  source: "ai" | "tech";
  /** What the AI originally said (never edited). null for tech-added lines. */
  ai_suggestion: AiSuggestionRow | null;
  /** AI evidence, ordered by visible_start_ms. Quotes are tech-only. */
  mentions: MentionRow[];
  /** Ordered by position; clips[0] is the main clip. */
  clips: ClipDetail[];
  /** Thumbnail of the clip with position 1, if it has one. */
  photo_url: string | null;
}

export interface ClipDetail extends ClipRow {
  /** Current cut (tech media URL), null until first cut. */
  url: string | null;
  /** The chosen thumbnail frame's URL, if set. */
  thumbnail_url: string | null;
  /** All frames of this clip (candidates + tech-picked), ordered by timestamp_ms. */
  frames: FrameDetail[];
}

export interface FrameDetail extends FrameRow {
  url: string;
}

export interface ProgressCounts {
  segments_total: number;
  segments_uploaded: number;
  clips_total: number;
  clips_ready: number;
  clips_pending: number;
  clips_failed: number;
}

export interface SendingState {
  /** Latest frozen version, null if never sent. */
  latest_version: { version_number: number; sent_at: string } | null;
  /** `${PUBLIC_BASE_URL}/r/${share_token}` once sent. */
  share_url: string | null;
  /**
   * True when sent and either a tech edit is newer than the latest version's
   * sent_at, or the customer/vehicle fields differ from that version's copy.
   */
  unsent_changes: boolean;
}

// ── GET /api/share/[token]?v= ────────────────────────────────────────────────
// Customer-facing. Never contains inspection ids, line/clip ids, quotes, AI
// originals or storage paths. Media goes through /api/share/[token]/media/...
export interface ShareResponse {
  /** The version being shown (latest unless ?v= is given). */
  version: ShareVersion;
  /** The version before `version`, for "Updated"/"New" badges and the diff. */
  previous: ShareVersion | null;
  /** All versions, ascending by version_number, for the history links. */
  versions: { version_number: number; sent_at: string }[];
  latest_version_number: number;
}

export interface ShareVersion {
  version_number: number;
  sent_at: string;
  customer_name: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  vin: string;
  /** In the tech's order (position). Group by rating on the client. */
  lines: ShareLine[];
}

export interface ShareLine {
  /**
   * Opaque id, stable across versions of the same report (derived from the
   * source line). Use it to match lines between versions for diffs.
   */
  key: string;
  position: number;
  component_name: string;
  note: string;
  rating: LineRating;
  /** Where on the car, for the diagram; null = not on the car. */
  car_zone: CarZone | null;
  /** Ordered by position; clips[0] is the main clip and its thumbnail is the line photo. */
  clips: ShareClip[];
}

export interface ShareClip {
  position: number;
  clip_url: string;
  thumbnail_url: string;
  /** Drawings over the playing clip, in clip time (0 = clip start). No ids. */
  annotations: ClipAnnotation[];
}
