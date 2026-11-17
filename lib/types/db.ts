/**
 * Row types — one per table in supabase/migrations/0001_init.sql.
 * Column names are kept exactly (snake_case). Pure types; safe anywhere.
 *
 * Conventions (enforced by lib/db.ts):
 * - timestamptz -> ISO-8601 string
 * - bigint identity (jobs.id, edits.id) -> string
 * - smallint / integer -> number
 * - jsonb -> parsed JSON
 */

// ── Enums ────────────────────────────────────────────────────────────────────
export type InspectionStatus = "recording" | "processing" | "ready_for_review" | "sent" | "failed";
export type ProcessingStep = "converting" | "analyzing" | "cutting";
export type SegmentStatus = "uploading" | "uploaded" | "failed";
export type LineRating = "good" | "monitor" | "needs_attention";
export type RatingBasis = "stated" | "inferred";
export type MediaStatus = "pending" | "ready" | "failed";
export type FrameOrigin = "ai_candidate" | "tech_picked";
export type EditAction = "created" | "updated" | "deleted";
export type EditActor = "ai" | "tech";
export type JobKind = "process_inspection" | "cut_clip" | "extract_frame";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export const LINE_RATINGS: readonly LineRating[] = ["good", "monitor", "needs_attention"] as const;

// ── Tables ───────────────────────────────────────────────────────────────────
export interface InspectionRow {
  id: string;
  customer_name: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vin: string | null;
  status: InspectionStatus;
  processing_step: ProcessingStep | null;
  failure_reason: string | null;
  video_path: string | null;
  duration_ms: number | null;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoSegmentRow {
  id: string;
  inspection_id: string;
  segment_number: number;
  status: SegmentStatus;
  original_path: string;
  mime_type: string;
  duration_ms: number | null;
  offset_ms: number | null;
  created_at: string;
}

export interface LineItemRow {
  id: string;
  inspection_id: string;
  position: number;
  component_name: string;
  note: string;
  rating: LineRating;
  created_at: string;
  updated_at: string;
}

export interface AiSuggestionRow {
  line_item_id: string;
  component_name: string;
  note: string;
  rating: LineRating;
  rating_basis: RatingBasis;
  model: string;
  created_at: string;
}

export interface MentionRow {
  id: string;
  line_item_id: string;
  visible_start_ms: number;
  visible_end_ms: number;
  best_frame_ms: number;
  quote: string;
  created_at: string;
}

export interface ClipRow {
  id: string;
  inspection_id: string;
  line_item_id: string;
  mention_id: string | null;
  position: number;
  start_ms: number;
  end_ms: number;
  status: MediaStatus;
  path: string | null;
  cut_count: number;
  thumbnail_frame_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FrameRow {
  id: string;
  clip_id: string;
  timestamp_ms: number;
  storage_path: string;
  origin: FrameOrigin;
  sharpness: number;
  created_at: string;
}

export interface ReportVersionRow {
  id: string;
  inspection_id: string;
  version_number: number;
  customer_name: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  vin: string;
  sent_at: string;
}

export interface ReportVersionLineRow {
  id: string;
  report_version_id: string;
  source_line_id: string;
  position: number;
  component_name: string;
  note: string;
  rating: LineRating;
}

export interface ReportVersionClipRow {
  id: string;
  report_version_line_id: string;
  position: number;
  clip_path: string;
  thumbnail_path: string;
}

export interface EditRow {
  id: string;
  inspection_id: string;
  line_item_id: string;
  clip_id: string | null;
  action: EditAction;
  actor: EditActor;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  inspection_id: string;
  clip_id: string | null;
  kind: JobKind;
  frame_timestamp_ms: number | null;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  run_after: string;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}
